/**
 * NOTES:
 * - This is the client side that's going to be accessing the smart contract,
 * sending over instructions, etc.
 * - This Client code is mostly from the solana/web3 library.
 * - Even on the client side you still need to do the serialize/deserialize
 */

import {
  establishConnection,
  establishPayer,
  checkProgram,
  sayHello,
  reportGreetings,
} from './hello_world';

async function main() {
  console.log("Let's say hello to a Solana account...");

  // Establish connection to the cluster
  await establishConnection();

  // Determine who pays for the fees
  await establishPayer();

  // Check if the program has been deployed
  await checkProgram();

  // Say hello to an account
  // NOTE msg must be same length as account data for borsh!
  await sayHello('Hello1234567');

  // Find out how many times that account has been greeted
  await reportGreetings();

  console.log('Success');
}

main().then(
  () => process.exit(),
  err => {
    console.error(err);
    process.exit(-1);
  },
);
