export type Status =
  | "pending_initialized"
  | "pending_queued"
  | "active_ongoing"
  | "active_exiting"
  | "active_slashed"
  | "exited_unslashed"
  | "exited_slashed"
  | "withdrawal_possible"
  | "withdrawal_done";


export interface ValidatorResponse {
  execution_optimistic: boolean;
  data: Array<{
    index: string;
    balance: string;
    status: Status;
    validator: {
      pubkey: string;
      activation_eligibility_epoch: string;
      activation_epoch: string;
      exit_epoch: string;
      withdrawable_epoch: string;
      withdrawal_credentials: string;
      slashed: string;
      effective_balance: string;
    };
  }>;
}

export interface StoredState {
  [pubkey: string]: Status;
}

export interface KeyShareObj {
  sharesData: `0x${string}`
  publicKey: `0x${string}`
  operatorIds: number[]
}

export interface KeyShareMapping {
  [key: string]: KeyShareObj;
}

export interface DepositFileItem {
        pubkey: string;
        withdrawal_credentials: string;
        amount: number
        signature: string;
        deposit_message_root: string;
        deposit_data_root: string;
        fork_version: string;
        network_name: "hoodi" | "mainnet" | "sepolia";
        deposit_cli_version: string;
}