import { SSVSDK, chains } from "@ssv-labs/ssv-sdk";
import { http, createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";


export function findEnvVariable(variable: string | undefined, varName: string): string {
  const envVarValue = variable;
  if (envVarValue) {
    return envVarValue;
  }

  throw new Error(
    `Error: ${varName} environment variable is required. Please set it and try again.`
  );
}

export function getViemClients() {
    const privateKey = findEnvVariable(process.env.PRIVATE_KEY, "PRIVATE_KEY");
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const chain = findEnvVariable(process.env.CHAIN, "CHAIN") === 'hoodi' ? chains.hoodi : chains.mainnet;
    
    // Setup viem clients
    const transport = http();
    const publicClient = createPublicClient({
      chain,
      transport,
    });

    const account = privateKeyToAccount(formattedPrivateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain,
      transport,
    });

    return {publicClient, walletClient}
}


export async function initializeSSV(): Promise<SSVSDK> {
  try {
    const subgraphEndpoint = findEnvVariable(process.env.SUBGRAPH_ENDPOINT, "SUBGRAPH_ENDPOINT");
    const subgraphApiKey = findEnvVariable(process.env.SUBGRAPH_API_KEY, "SUBGRAPH_API_KEY");

    const {publicClient, walletClient} = getViemClients()

    // Initialize SDK with viem clients
    const sdk = new SSVSDK({
      publicClient,
      walletClient,
      extendedConfig: {
        subgraph: {
          apiKey: subgraphApiKey,
          endpoint: subgraphEndpoint,
        }
      }
    });

    console.log("✅ SSV SDK initialized successfully");
    return sdk;
  } catch (error) {
    throw new Error(`Failed to initialize SSV SDK: ${error instanceof Error ? error.message : String(error)}`);
  }
}
