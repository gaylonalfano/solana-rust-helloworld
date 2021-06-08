/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import os from 'os';
import fs from 'mz/fs';
import path from 'path';
import yaml from 'yaml';
import {Account, Connection} from '@solana/web3.js';

// Allows for a pause/sleep before continuing the execution
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function newAccountWithLamports(
  connection: Connection,
  lamports = 1000000,
): Promise<Account> {
  // NOTE Type "Account" is NOT a Solana account! It's actually a Keypair,
  // which is an Object that represents the Private & Public Keys for an
  // account that will be created later.
  const account = new Account();
  const signature = await connection.requestAirdrop(
    account.publicKey,
    lamports,
  );
  await connection.confirmTransaction(signature);
  return account;
}

/**
 * @private
 */
async function getConfig(): Promise<any> {
  // Path to Solana CLI config file
  const CONFIG_FILE_PATH = path.resolve(
    os.homedir(),
    '.config',
    'solana',
    'cli',
    'config.yml',
  );
  const configYml = await fs.readFile(CONFIG_FILE_PATH, {encoding: 'utf8'});
  return yaml.parse(configYml);
}

/**
 * Load and parse the Solana CLI config file to determine which RPC url to use
 */
export async function getRpcUrl(): Promise<string> {
  try {
    const config = await getConfig();
    if (!config.json_rpc_url) throw new Error('Missing RPC URL');
    return config.json_rpc_url;
  } catch (err) {
    console.warn(
      'Failed to read RPC url from CLI config file, falling back to localhost',
    );
    return 'http://localhost:8899';
  }
}

/**
 * Load and parse the Solana CLI config file to determine which payer to use
 */
export async function getPayer(): Promise<Account> {
  // NOTE Configure/Create a new keypair (NOT an account!) that represents the account
  // from which monies/lamports will come out in order to pay for all the
  // transactions that we're about to execute. Again, every transaction you
  // request requires money to pay for the transaction. Creating the keypair is
  // one of the first steps into creating an account.
  try {
    const config = await getConfig();
    // NOTE In this example, you can use your own wallet's private/public keypair
    // in order to generate the account. You don't have to do this if you don't want.
    if (!config.keypair_path) throw new Error('Missing keypair path');
    return readAccountFromFile(config.keypair_path);
  } catch (err) {
    console.warn(
      'Failed to read keypair from CLI config file, falling back to new random keypair',
    );
    return new Account();
  }
}

/**
 * Create an Account from a keypair file
 */
export async function readAccountFromFile(filePath: string): Promise<Account> {
  // NOTE Reads in the keypair and creates a new Account type from this original keypair
  // and returns/generates a "real" keypair object that will be later used to create a
  // REAL Solana Account existing on the network. A little confusing...
  const keypairString = await fs.readFile(filePath, {encoding: 'utf8'});
  const keypairBuffer = Buffer.from(JSON.parse(keypairString));
  return new Account(keypairBuffer);
}
