/*
NOTES:
- Borsh is used to DESERIALIZE binary objects into data types that we can
work with. Borsh then takes data types and SERIALIZES them back to binary format.
- Rust isn't an OOP language! It only has struct, enum, tuple.
- Rust has TRAITS that we can inherit. By doing this, we're giving the GreetingAccount
the power to encode/decode itself (via inheriting from Borsh)
- "!" indicates a macro which is a shorthand that points to a multiline 
set of code (so it will log all the lines below it)
- entrypoint! is a cool Solana feature. You don't have to create monolithic (single)
smart contracts that do everything you need your app to perform. Instead, it's
possible for smart contracts (programs) to call into other smart contracts -- even those
programs created by others! Reminds me of components really.This entrypoint!() feature 
allows this particular smart contract (program) to be entered into,
and therefore controlled by, another program. In general, for any Rust program,
you will add no-entrypoint = [] to the Cargo.toml file (similar to package.json).
- The BPF Loader is what's used to load other programs (that have already been deployed!)
that are requested into the runtime. As a part of doing this, the BPF Loader will
mark the program as read-only and executable. So, in essence, 
every program (ie. the account the program lives in) that wants to
be run needs to be set up as read-only and executable in order for it to be useable.
Once these settings have been set, they cannot be unset, and the program account has to
stay in that format forever. 
- There are flags in every account that indicate whether it is read-only or writable.
On top of ownership, human holders private key signature, etc., you also need the account
to be marked/flagged as writable BEFORE you can actually make modifications to the account.
If the account is read-only, then you can access it but only for adding lamports instead of
deducting lamports (everyone doesn't mind receiving money).
*/
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

// NOTE Rust has TRAITS that you can inherit from. So, below, the
// "#[...]" annotation syntax is shorthand for inheriting functionality
// from these other types (BorshSerialize, Debug, etc), without having to
// manually write the code yourself. This means our new struct type GreetingAccount,
// will have access to any prexisting methods from these other types.
/// Define the type of state stored in accounts
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct GreetingAccount {
    /// number of greetings
    pub counter: u32,
}

// Declare and export the program's entrypoint
// NOTE This entrypoint!() feature allows this particular smart contract (program)
// to be entered into, and therefore controlled by, another program.
entrypoint!(process_instruction);

// Program entrypoint's implementation
pub fn process_instruction(
    // NOTE On the client-side we'll have a mirror of these params in JS as well
    // Remember that the program will always exist inside an account! It's not standalone.
    // NOTE "&" is for declaring Type
    program_id: &Pubkey, // Public key of the account the hello world program was loaded into/lives inside
    accounts: &[AccountInfo], // The account to say hello to
    _instruction_data: &[u8], // Ignored, all helloworld instructions are hellos
) -> ProgramResult {
    // Can log and view using command: solana logs -u localhost
    // NOTE Apparently println!() isn't as performant as msg!()
    // NOTE A "!" indicates a macro which is a shorthand that points to a
    // multiline set of code (so it will log all the lines below it)
    msg!("Hello World Rust program entrypoint");

    // Iterating accounts is safer then indexing
    // NOTE You make array iterable using .iter() so you can call next()
    // NOTE &mut means that we're getting a reference to a MUTABLE version of the
    // accounts.iter() array, and I guess storing the reference inside accounts_iter.
    let accounts_iter = &mut accounts.iter();

    // Get the account to say hello to
    // NOTE There is a built-in helper function instead of manually calling next(),next(),...
    let account = next_account_info(accounts_iter)?;

    // The account must be owned by the program in order to modify its data
    // NOTE The account is the account that we want to do something to. So,
    // we're confirming that its owner is the program_id. Otherwise, throw error.
    // NOTE If this check fails at any point, then the entire transaction this
    // occurs within/lives within, will be exited and unroll itself.
    // NOTE "owner" is NOT the human owner. It is the programmatic controller of the account!
    if account.owner != program_id {
        // Log the error message
        msg!("Greeted account does not have the correct program id");
        // Return the specific Error Type
        return Err(ProgramError::IncorrectProgramId);
    }

    // Now we get to what we actually want to do for this smart contract
    // Increment and store the number of times the account has been greeted
    // NOTE Once we get the data in account.data in its proper form (after encoding/decoding)
    // we can do what we want (e.g, increment a number, etc.). We use Borsh library to
    // take binary and DESERIALIZES it (so we can modify), then give Borsh a data type so that
    // it can SERIALIZE the data type back into binary format.
    // NOTE Below we're decoding "data" from an arbitrary bytearray, to an actual Type
    // instance (greeting_account is a type instance of GreetingAccount type).
    let mut greeting_account = GreetingAccount::try_from_slice(&account.data.borrow())?;
    // Now that data is decoded, we do what we want to data (e.g., increment).
    greeting_account.counter += 1;
    // Next we encode it all back into the data.
    greeting_account.serialize(&mut &mut account.data.borrow_mut()[..])?;
    // NOTE The above serialize() line could be split up as well for alternative syntax:
    // let data = &mut &mut account.data.borrow_mut()[..];
    // greeting_account.serialize(data)?;

    // Finally wrap it all up with a logging message.
    msg!("Greeted {} time(s)!", greeting_account.counter);

    Ok(())
}

// Sanity tests
#[cfg(test)]
mod test {
    use super::*;
    use solana_program::clock::Epoch;
    use std::mem;

    #[test]
    fn test_sanity() {
        let program_id = Pubkey::default();
        let key = Pubkey::default();
        let mut lamports = 0;
        let mut data = vec![0; mem::size_of::<u32>()];
        let owner = Pubkey::default();
        let account = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
            Epoch::default(),
        );
        let instruction_data: Vec<u8> = Vec::new();

        let accounts = vec![account];

        assert_eq!(
            GreetingAccount::try_from_slice(&accounts[0].data.borrow())
                .unwrap()
                .counter,
            0
        );
        process_instruction(&program_id, &accounts, &instruction_data).unwrap();
        assert_eq!(
            GreetingAccount::try_from_slice(&accounts[0].data.borrow())
                .unwrap()
                .counter,
            1
        );
        process_instruction(&program_id, &accounts, &instruction_data).unwrap();
        assert_eq!(
            GreetingAccount::try_from_slice(&accounts[0].data.borrow())
                .unwrap()
                .counter,
            2
        );
    }
}
