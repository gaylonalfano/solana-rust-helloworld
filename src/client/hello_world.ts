/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import {
  Account,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import fs from 'mz/fs';
import path from 'path';
import * as borsh from 'borsh';

import {
  getPayer,
  getRpcUrl,
  newAccountWithLamports,
  readAccountFromFile,
} from './utils';

/**
 * Connection to the network
 */
let connection: Connection;

/**
 * Connection to the network
 */
let payerAccount: Account;

/**
 * Hello world's program id
 */
let programId: PublicKey;

/**
 * The public key of the account we are saying hello to
 */
let greetedPubkey: PublicKey;

/**
 * Path to program files
 */
const PROGRAM_PATH = path.resolve(__dirname, '../../dist/program');

/**
 * Path to program shared object file which should be deployed on chain.
 * This file is created when running either:
 *   - `npm run build:program-c`
 *   - `npm run build:program-rust`
 */
const PROGRAM_SO_PATH = path.join(PROGRAM_PATH, 'helloworld.so');

/**
 * Path to the keypair of the deployed program.
 * This file is created when running `solana program deploy dist/program/helloworld.so`
 */
const PROGRAM_KEYPAIR_PATH = path.join(PROGRAM_PATH, 'helloworld-keypair.json');

/**
 * The state of a greeting account managed by the hello world program
 */
class GreetingAccount {
  // NOTE This class is analogous to Rust struct type (pub struct GreetingAccount)
  counter = 0;
  // NOTE The borsh library requires that we use a constructor like below
  constructor(fields: {counter: number} | undefined = undefined) {
    // Any new class properties would need to be set within this scope
    if (fields) {
      this.counter = fields.counter;
      // this.newField = fields.newField;
    }
  }
}

/**
 * Borsh schema definition for greeting accounts
 */
const GreetingSchema = new Map([
  // NOTE Borsh needs additional metadata in order to do a Mapping.
  // It needs the client side Type (GreetingAccount), and it also needs
  // metadata from our Rust program. This is all provided to the
  // borsh.serialize() method below (see GREETING_SIZE).
  [GreetingAccount, {kind: 'struct', fields: [['counter', 'u32']]}],
]);

/**
 * The expected size of each greeting account.
 */
// NOTE This serializes (encode) to the destination data type (Uint8Array which is an
// Array of 8 bytes) and it's taking out the length (size). This is how it knows how
// much data size is required.
const GREETING_SIZE = borsh.serialize(GreetingSchema, new GreetingAccount())
  .length;

/**
 * Establish a connection to the cluster
 */
export async function establishConnection(): Promise<void> {
  const rpcUrl = await getRpcUrl();
  connection = new Connection(rpcUrl, 'confirmed');
  const version = await connection.getVersion();
  console.log('Connection to cluster established:', rpcUrl, version);
}

/**
 * Establish an account to pay for everything
 */
export async function establishPayer(): Promise<void> {
  let fees = 0;
  if (!payerAccount) {
    // NOTE We need to compute the total fees needed in order to complete
    // all of the things we need to do. This is what this attempts.
    const {feeCalculator} = await connection.getRecentBlockhash();

    // Calculate the cost to fund the greeter account
    // NOTE You can either pay rent to keep your account live on the network,
    // or you can stake a higher number of lamports in order to not have to
    // pay rent, not have your balance decrease, and allow your account to live
    // on the network indefinitely. To compute the amount needed, we use this
    // helper method and pass in the size of our account's data (i.e., GREETING_SIZE)
    fees += await connection.getMinimumBalanceForRentExemption(GREETING_SIZE);

    // Calculate the cost of sending transactions
    // NOTE Typically they compute the number of signatures needed, but since
    // this is just testing, they're giving us a buffer (*100) so we can run
    // this multiple times. This prevents us from having to recreate the payerAccount
    // again and again each time. Also, since we're testing, we don't have to restock
    // lamports and ask for another airdrop, etc.
    fees += feeCalculator.lamportsPerSignature * 100; // wag

    try {
      // Get payer from cli config
      // NOTE Again, this is creating the initial keypair, NOT the actual Solana account
      payerAccount = await getPayer();
    } catch (err) {
      // Fund a new payer via airdrop
      // NOTE This is the helper method from utils.ts
      payerAccount = await newAccountWithLamports(connection, fees);
    }
  }

  // Check that we have sufficient lamports
  const lamports = await connection.getBalance(payerAccount.publicKey);
  if (lamports < fees) {
    // This should only happen when using cli config keypair
    const sig = await connection.requestAirdrop(
      payerAccount.publicKey,
      fees - lamports,
    );
    await connection.confirmTransaction(sig);
  }

  console.log(
    'Using account',
    payerAccount.publicKey.toBase58(),
    'containing',
    lamports / LAMPORTS_PER_SOL,
    'SOL to pay for fees',
  );
}

/**
 * Check if the hello world BPF program has been deployed
 */
export async function checkProgram(): Promise<void> {
  // Read program id from keypair file
  try {
    const programAccount = await readAccountFromFile(PROGRAM_KEYPAIR_PATH);
    programId = programAccount.publicKey;
  } catch (err) {
    const errMsg = (err as Error).message;
    throw new Error(
      `Failed to read program keypair at '${PROGRAM_KEYPAIR_PATH}' due to error: ${errMsg}. Program may need to be deployed with \`solana program deploy dist/program/helloworld.so\``,
    );
  }

  // Check if the program has been deployed
  // NOTE AccountInfo is a REAL Solana account!
  // This gets the actual account living on Solana blockchain
  // based on the program account's public address
  const programInfo = await connection.getAccountInfo(programId);
  if (programInfo === null) {
    // Check whether there is a compiled binary of the program itself
    if (fs.existsSync(PROGRAM_SO_PATH)) {
      throw new Error(
        'Program needs to be deployed with `solana program deploy dist/program/helloworld.so`',
      );
    } else {
      throw new Error('Program needs to be built and deployed');
    }
    // Check that program's account is executable
  } else if (!programInfo.executable) {
    throw new Error(`Program is not executable`);
  }
  console.log(`Using program ${programId.toBase58()}`);

  // Derive the address of a greeting account from the program so that it's easy to find later.
  const GREETING_SEED = 'hello';
  // NOTE This is creating a seed in order to prepare for the actual AccountInfo object creation
  greetedPubkey = await PublicKey.createWithSeed(
    payerAccount.publicKey,
    GREETING_SEED,
    programId,
  );

  // Check if the greeting account has already been created
  // NOTE This gets into the meat of writing to the system runtime.
  // NOTE This greetedAccount is going to be the Solana account that is written to/modified
  // by our Rust program i.e., GreetingAccount::try_from_slice(&account.data.borrow())?;
  const greetedAccount = await connection.getAccountInfo(greetedPubkey);
  if (greetedAccount === null) {
    // Account doesn't exist so it tries to create it.
    console.log(
      'Creating account',
      greetedPubkey.toBase58(),
      'to say hello to',
    );
    // Check the minimum lamports we're going to need in order to avoid rent
    const lamports = await connection.getMinimumBalanceForRentExemption(
      // NOTE Check the size of the data that is inside the account, where 'data'
      // refers to GreetingAccount::try_from_slice(&account.data.borrow())? in Rust program.
      // The size of data since it's directly proportional to RentExemption monies required.
      GREETING_SIZE,
    );

    // NOTE Finally create our first transaction and add instructions inside
    const transaction = new Transaction().add(
      // Use SystemProgram to create our only instruction
      SystemProgram.createAccountWithSeed({
        fromPubkey: payerAccount.publicKey, // The transaction payer
        basePubkey: payerAccount.publicKey, // The transaction payer
        seed: GREETING_SEED, // Using seed value to create account
        newAccountPubkey: greetedPubkey, // The keypair we'd like to use
        lamports, // The base amount of lamports we'd like the account to have to avoid rent
        space: GREETING_SIZE, // The size of data we're requesting on this account
        programId, // The programId that will own, access, control and update this account
      }),
    );
    await sendAndConfirmTransaction(connection, transaction, [payerAccount]);
  }
}

/**
 * Say hello
 */
export async function sayHello(): Promise<void> {
  // Get the account affected by our program
  console.log('Saying hello to', greetedPubkey.toBase58());
  // Create a new transaction instruction that we'll add to transaction
  const instruction = new TransactionInstruction({
    keys: [{pubkey: greetedPubkey, isSigner: false, isWritable: true}],
    programId, // The controlling program
    data: Buffer.alloc(0), // Any data sent over (none in this example). All instructions are hellos
  });
  await sendAndConfirmTransaction(
    connection, // Run on same network
    // Create transaction and add our instruction (above)
    new Transaction().add(instruction),
    [payerAccount], // The transaction payer
  );
}

/**
 * Report the number of times the greeted account has been said hello to
 */
export async function reportGreetings(): Promise<void> {
  // Retrieve the greetedAccount/AccountInfo
  // NOTE Borsh serialize/deserialize is very similar to how it works in our
  // Rust program as well.
  const accountInfo = await connection.getAccountInfo(greetedPubkey);
  if (accountInfo === null) {
    throw 'Error: cannot find the greeted account';
  }
  // Retrieve data from this account on the network
  // Perform some deserializations (decode) (binary -> data type)
  // so that we have a JS type we can work with in JS.
  const greeting: GreetingAccount = borsh.deserialize(
    GreetingSchema,
    GreetingAccount,
    accountInfo.data,
  );
  // Last, we now have a GreetingAccount class/object instance,
  // so we can attempt to display the counter (data) value
  console.log(
    greetedPubkey.toBase58(),
    'has been greeted',
    greeting.counter,
    'time(s)',
  );
}
