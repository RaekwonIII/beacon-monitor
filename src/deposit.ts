import { findEnvVariable, getViemClients } from "./utils";
import { readdir } from "node:fs/promises";
import { DepositFileItem } from "./types";
import { DepositABI } from "./depositABI";

const DEPOSIT_CONTRACT_ADDRESS = "0x00000000219ab540356cBB839Cbe05303d7705Fa";

async function loadDeposit(keystoreDir: string): Promise<DepositFileItem[]> {
  try {
    const files = await readdir(keystoreDir);
    const depositFiles: DepositFileItem[] = [];
    for (const file of files) {
      if (file.startsWith("deposit")) {
        const content = await Bun.file(`${keystoreDir}/${file}`).text();
        depositFiles.push(...(JSON.parse(content) as DepositFileItem[]));
      }
    }
    return depositFiles;
  } catch (error) {
    console.error("Failed to read keystore JSON file:", error);
    throw new Error(
      "Failed to load keystore. Please check keystore JSON file exists and is valid.",
    );
  }
}

async function depositValidatorKeys() {
  const keystoreDir = findEnvVariable(process.env.KEYSTORE_DIR, "KEYSTORE_DIR");
  const depositData = await loadDeposit(keystoreDir);
  const { publicClient, walletClient } = getViemClients();
  const [account] = await walletClient.getAddresses();

  for (let depositItem of depositData) {
  
    const { request } = await publicClient.simulateContract({
      account,
      address: DEPOSIT_CONTRACT_ADDRESS,
      abi: DepositABI,
      functionName: "deposit",
      args: [

          `0x${depositItem.pubkey}` as `0x${string}`,
          account,
          `0x${depositItem.signature}` as `0x${string}`,
          `0x${depositItem.deposit_data_root}` as `0x${string}`
      ]
      }
    );
    await walletClient.writeContract(request);
  }
}

await depositValidatorKeys()
