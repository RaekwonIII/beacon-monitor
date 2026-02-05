#!/usr/bin/env bun

import {
  loadValidatorStatuses,
  saveValidatorStatuses,
  processFetchedValidators,
  filterPendingOnly,
} from "./storage";
import { fetchValidators } from "./beacon-client";
import { SSVSDK, chains } from '@ssv-labs/ssv-sdk'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KEYSHARES_FILE = path.join(__dirname, "..", "keyshares.json");

const POLL_INTERVAL_MILLISECONDS = 720 * 1000;

function validatePubkey(pubkey: string): boolean {
  const trimmed = pubkey.toLowerCase().trim();

  if (!trimmed.startsWith("0x")) {
    return false;
  }

  const hexPart = trimmed.substring(2);
  return /^[0-9a-f]+$/.test(hexPart);
}

function extractPubkeysFromCLI(args: string[]): string[] {
  const pubkeys: string[] = [];

  for (const arg of args) {
    if (arg.match(/^--?p$/) || arg.match(/^--?pubkey$/)) {
      return [];
    }

    if (arg.match(/^--?h$/) || arg.match(/^--help$/)) {
      console.log(`
beacon-monitor - Ethereum Beacon Node Validator Monitor

Usage:
  Provide validator public keys to monitor their activation status

Environment Variable:
  BEACON_NODE_URL - Required: Protocol + host + port of beacon node
  PRIVATE_KEY - Required: Private key for wallet to register validators
  CHAIN - Optional: Network chain (mainnet, sepolia) - default: mainnet

Examples:
   bun src/main.ts 0x... 0x... 0x...

  With environment variables:
    BEACON_NODE_URL=http://localhost:5052 PRIVATE_KEY=0x... bun src/main.ts 0x... 0x... 0x...

  Without pubkeys (monitors previously stored pending validators):
    BEACON_NODE_URL=http://localhost:5052 PRIVATE_KEY=0x... bun src/main.ts 

If you provide a BEACON_NODE_URL but no pubkeys, the system will only monitor
those public keys that have been previously registered as pending in the validators.json file.
`);

      process.exit(0);
    }

    if (validatePubkey(arg)) {
      pubkeys.push(arg);
    }
  }

  return pubkeys;
}

function findBeaconNodeConnection(): string {

  const envUrl = process.env.BEACON_NODE_URL;
  if (envUrl) {
    return envUrl;
  }

  throw new Error(
    "Error: BEACON_NODE_URL environment variable is required. " +
      "Please set it and try again. Example: BEACON_NODE_URL=http://localhost:5052",
  );
}

function findPrivateKey(): string {
  const privateKey = process.env.PRIVATE_KEY;
  if (privateKey) {
    return privateKey;
  }

  throw new Error(
    "Error: PRIVATE_KEY environment variable is required. " +
      "Please set it and try again.",
  );
}

function findChain(): typeof chains.mainnet | typeof chains.hoodi {
  const chainEnv = process.env.CHAIN;
  if (chainEnv === 'hoodi') {
    return chains.hoodi;
  }
  return chains.mainnet;
}

function nextEpochTime(): string {
  const now = new Date();
  const nextEpoch = new Date(now.getTime() + POLL_INTERVAL_MILLISECONDS);
  return nextEpoch.toLocaleTimeString();
}

async function initializeSSV(): Promise<SSVSDK> {
  try {
    const privateKey = findPrivateKey();
    const chain = findChain();
    
    // Setup viem clients
    const transport = http();
    const publicClient = createPublicClient({
      chain,
      transport,
    });
    
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(formattedPrivateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain,
      transport,
    });
    
    // Initialize SDK with viem clients
    const sdk = new SSVSDK({
      publicClient,
      walletClient,
    });
    
    console.log("✅ SSV SDK initialized successfully");
    return sdk;
  } catch (error) {
    throw new Error(`Failed to initialize SSV SDK: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadKeyshares(): Promise<any> {
  try {
    const fileExists = Bun.file(KEYSHARES_FILE).exists();
    if (!fileExists) {
      throw new Error("keyshares.json file not found");
    }

    const content = await Bun.file(KEYSHARES_FILE).text();
    const data = JSON.parse(content);
    
    return data;
  } catch (error) {
    console.error("Failed to read keyshares.json:", error);
    throw new Error("Failed to load keyshares. Please check keyshares.json exists and is valid.");
  }
}

export async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    let pubkeys = extractPubkeysFromCLI(args);

    const beaconUrl = findBeaconNodeConnection();
    const sdk = await initializeSSV();
    const keyshares = await loadKeyshares();

    console.log("📊 beacon-monitor starting...");
    console.log("🔗 Beacon node:", beaconUrl);

    let storedState = await loadValidatorStatuses();

    if (pubkeys.length > 0) {
      console.log(`📋 Initial pubkeys: ${pubkeys.length}`);
      console.log("🔍 Searching for last stored validators state");

      for (const pubkey of pubkeys) {
        if (!storedState.hasOwnProperty(pubkey)) {
          console.log(`✨ Added new validator to monitoring: ${pubkey}`);
          storedState[pubkey] = "pending_queued";
        }
      }

      saveValidatorStatuses(storedState);
    } else {
      console.log("🔍 No pubkeys provided via CLI");
    }

    while (true) {
      try {
        storedState = await loadValidatorStatuses();
        pubkeys = filterPendingOnly(storedState);
        console.log(`📈 Total pending validators to monitor: ${pubkeys.length}`);
        console.log("⏱️  Polling for new validator activations...");
        const response = await fetchValidators(
          beaconUrl,
          pubkeys,
        );
        const newStoredState = processFetchedValidators(response, storedState);
        saveValidatorStatuses(newStoredState);
        
        // Check for newly activated validators and register them
        const activatedValidators: string[] = [];
        for (const [pubkey, status] of Object.entries(newStoredState)) {
          if (status === "active_ongoing" && storedState[pubkey] !== "active_ongoing") {
            activatedValidators.push(pubkey);
          }
        }
        
        if (activatedValidators.length > 0) {
          console.log(`✅ Found ${activatedValidators.length} activated validators to register`);
          
          for (const pubkey of activatedValidators) {
            try {
              const keysharesPayload = keyshares[pubkey];
              if (!keysharesPayload) {
                console.log(`⚠️  No keyshares found for pubkey: ${pubkey}`);
                continue;
              }
              
              console.log(`🔄 Registering validator ${pubkey} with SSV network...`);
              
              // Register the validator
              const txnReceipt = await sdk.clusters.registerValidators({
                args: {
                  keyshares: keysharesPayload,
                  depositAmount: 100000n, // Placeholder - actual deposit amount should be set based on requirements
                },
              }).then(tx => tx.wait());
              
              console.log(`✅ Successfully registered validator ${pubkey}`);
            } catch (regError) {
              console.error(`❌ Failed to register validator ${pubkey}:`, 
                regError instanceof Error ? regError.message : String(regError));
            }
          }
        }
        
        if (Object.keys(newStoredState).length === 0) {
          console.log("✅ All pending validators have been activated!");
          console.log("💾 Clearing validators.json");
          saveValidatorStatuses({});
          process.exit(0);
        }

        console.log("⏱️  Next poll in 12 minutes: ", nextEpochTime());
        await new Promise((resolve) =>
          setTimeout(resolve, POLL_INTERVAL_MILLISECONDS),
        );
      } catch (error) {
        console.error(
          `❌ Error during polling: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.log("⏱️  Waiting for next interval...");
        await new Promise((resolve) =>
          setTimeout(resolve, POLL_INTERVAL_MILLISECONDS),
        );
      }
    }
  } catch (error) {
    console.error(
      `Fatal error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

await main();
