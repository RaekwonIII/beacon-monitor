import { readdir } from "node:fs/promises";
import { findEnvVariable, initializeSSV } from "./utils";

async function loadKeystores(keystoreDir: string): Promise<string[]> {
  try {
    const files = await readdir(keystoreDir);
    const keystores: string[] = [];
    for (const file of files) {
      if (file.startsWith("keystore")) {
        const content = await Bun.file(`${keystoreDir}/${file}`).text();
        keystores.push(content);
      }
    }
    return keystores;
  } catch (error) {
    console.error("Failed to read keystore JSON file:", error);
    throw new Error(
      "Failed to load keystore. Please check keystore JSON file exists and is valid.",
    );
  }
}

async function writeKeyshares(keysharesFile: string, keyshares: string) {
  try {
    Bun.write(keysharesFile, keyshares);
  } catch (error) {
    console.error("Failed to write keyshares.json:", error);
    throw new Error("Failed to write keyshares.json");
  }
}

async function generate(): Promise<void> {
  const operatorIds = findEnvVariable(
    process.env.OPERATOR_IDS,
    "OPERATOR_IDS",
  ).split(",");
  const keysharesFile = findEnvVariable(
    process.env.KEYSHARES_FILE,
    "KEYSHARES_FILE",
  );
  const keystoreDir = findEnvVariable(process.env.KEYSTORE_DIR, "KEYSTORE_DIR");
  const keystorePass = findEnvVariable(
    process.env.KEYSTORE_PASS,
    "KEYSTORE_PASS",
  );
  const ownerAddress = findEnvVariable(
    process.env.OWNER_ADDRESS,
    "OWNER_ADDRESS",
  );
  const keystores = await loadKeystores(keystoreDir);

  const sdk = await initializeSSV();

  let nonce = Number(await sdk.api.getOwnerNonce({ owner: ownerAddress }));
  let operators = await sdk.api.getOperators({ operatorIds });

  const keysharesPayload = await sdk.utils.generateKeyShares({
    keystore: keystores,
    keystore_password: keystorePass,
    operator_keys: operators.map((operator) => operator.publicKey),
    operator_ids: operators.map((operator) => parseInt(operator.id)),
    owner_address: ownerAddress as string,
    nonce: nonce,
  });

  await writeKeyshares(keysharesFile, JSON.stringify(keysharesPayload));
  console.log(JSON.stringify(keysharesPayload));
  // const txnReceipt = await sdk.clusters.registerValidators({
  //   args: {
  //     keyshares: keysharesPayload,
  //     depositAmount: 100000n, // Placeholder - actual deposit amount should be set based on requirements
  //   },
  // }).then(tx => tx.wait());

  // console.log(txnReceipt.transactionHash)
}

await generate();
