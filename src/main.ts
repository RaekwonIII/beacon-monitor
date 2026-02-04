#!/usr/bin/env bun

import {
  loadValidatorStatuses,
  saveValidatorStatuses,
  processFetchedValidators,
  filterPendingOnly,
} from "./storage";
import { fetchValidators } from "./beacon-client";

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

Examples:
   bun src/main.ts 0x... 0x... 0x...

  With environment variable:
    BEACON_NODE_URL=http://localhost:5052 bun src/main.ts 0x... 0x... 0x...

  Without pubkeys (monitors previously stored pending validators):
    BEACON_NODE_URL=http://localhost:5052 bun src/main.ts 

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

function nextEpochTime(): string {
  const now = new Date();
  const nextEpoch = new Date(now.getTime() + POLL_INTERVAL_MILLISECONDS);
  return nextEpoch.toLocaleTimeString();
}

export async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    let pubkeys = extractPubkeysFromCLI(args);

    const beaconUrl = findBeaconNodeConnection();

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
