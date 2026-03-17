DAY 1 ->
command to get the sol on ur address : `solana balance`

command to request airdrop : `solana airdrop {amount_u_want} {YOUR_WALLET_ADDRESS}`

command to check ur public address : `solana address`

my solana address : `H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY`

1) anchor init day1 >> cd day1 >> anchor build :
   `creates an anchor project`


2) solana config set --url localhost : (just a configuration file) :
```rust
`Config File: /Users/hail_the_lord/.config/solana/cli/config.yml
RPC URL: http://localhost:8899
WebSocket URL: ws://localhost:8900/ (computed)
Keypair Path: /Users/hail_the_lord/.config/solana/id.json
Commitment: confirmed `
```

3) solana-test-validator :
   (this keeps running a local blockchain) + (creates a local folder where you ran as `test-ledger`)

4) anchor keys sync : does some sync between (Anchor.toml + your code regarding program id)

5) anchor test --skip-local-validator :
   why --skip-local-validator  cuzz we just started the local blockchain using solana-test-validator
   so now dont do it it will be in conflict with the port.
   normally anchor test is like forge test, it runs a local blockchain + deploys the program to it + runs the tests.
+ ends the local blockchain.

6) solana-test-validator --reset : resets the local blockchain, to not check agianst old block chain -- CAN BE SKIPPED

7) anchor test --skip-local-validator : (Just runninng agian cuzz we changed our file to see new output)

8) `solana logs` -- which gives the same output but in real time by listing to logs
   
9) deployed contract details : `solana program show {programId}`
```terminaloutput
Program Id: HWQLX3qYxV9F4DLuQpFg48ivMmknHLizGmzB5PARW6ea
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: BZKqKoMMkJkzpL4FM97AgmP1EN7ryAD6nCFqRkgub3ZJ
Authority: H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY
Last Deployed In Slot: 10113
Data Length: 179000 (0x2bb38) bytes
Balance: 1.24704408 SOL
```
10) when you intialize once the local blockchain stores that permannetly in the `test-ledger` -- basically local blockchain
     next when ever you run the same code after some updation in logic the code is intialized already so will alwyas revert
     to handle this during development time :

```diff
// In Cargo.toml of individual file :
[dependencies]
- anchor-lang = "mentioned version number"
+ anchor-lang = {version = "mentioned version number", features = ["init-if-needed"]}
```

& after this add the `init-if-needed` in the macro :
```rust
```

-----

# AFTER BUILD :
1. anchor creates a file target/types/module_name.ts file, for eg `lord.ts`
2. In your test file : import it always as : `import { Lord } from "../target/types/lord.ts";`
3. this import `Lord` is used to create an instance of the program.
4. also we need to figure out where does Lord original module resides so inside the : `programs/{folder_name}/src/lib.rs` where inside the file lib.rs resides our module
5. this folderName is exact same as when you did `anchor init folder_name` -- creating a anchor proj
6. so : `const program = anchor.workspace.folder_name as Program<Lord>;`
7. now inside it : `const tx = await program.methods.functionName().rpc();` -- here functionName is like `function_name()` in the `Lord` module.
```typescript
import * as anchor from "@coral-xyz/anchor";
import {Program} from "@coral-xyz/anchor";
import { Lord } from "../target/types/lord";

describe("whaterver test group ...", () => {
   // Configure the client to use the local cluster.
   anchor.setProvider(anchor.AnchorProvider.env());
   
   const program = anchor.workspace.folder_name as Program<Lord>;
   
   it("1st test in the group", async () => {
      const tx = await program.methods.functonName().rpc();
   });
});
```
-----

# TX INFO :
1. A `single tx` may contain **multiple** `instruction` from same authorizer or **just 1** depends if he wants to batch or not.
2. `instruction` : (program_id, accounts[], data{function name in bytes})

-----

# CLOSE A programID:
1. only a deployed programId can be closed.
2. `solana program close --bypass-warning {programID}`
3. after closing it, you can't deploy it again -- you bacically need to create a new programId. -- so new private key in the machine
4. the SOL automatically gets transferred to the authority account.


# Change private key :
```rust
solana-keygen new \
--no-bip39-passphrase \
-o target/deploy/folder_name-keypair.json --force
```


# Raw typescript file to test & what happens before tansaction :
1. create a connection to the solona cluster or local block chain :
```typescript
// requires : import {Connection} from "@solana/web3.js";
const connection = new Connection("https../portno", "confirmed");
```
2. lets create a ur walletKeyPair using the private key stored in ur machine : ${home}/.config/solana/id.json :
```typescript
// requires : import {Keypair} from "@solana/web3.js";
// require : file system : import fs from "fs"; 
const walletKeypair = Keypair.fromSecretKey( Uint8Array.from( 
        JSON.parse( fs.readFileSync( process.env.HOME + "/.config/solana/id.json","utf-8"))
));
```
3. the program you wanna call :
```typescript
// requires : import {PublicKey} from "@solana/web3.js";
const programId = new PublicKey("...programId...");
```
4. the function ur are gonna call its : discriminator or unique bytes -- just like function signature in evm
```typescript
// how to find the unique signature array of nums to ur function which needs to be called :
// requires : import crypto from "crypto";
function instructionDiscriminator(name: string): Buffer {
   const preimage = `global:${name}`;
   const hash = crypto.createHash("sha256").update(preimage).digest();
   return hash.slice(0, 8);
}

const data = instructionDiscriminator("function which ur gonna call"); // remember to not change var data to anything below line will start to error :

const instruction = new TransactionInstruction({
   programId, // <@ -- The program Id you wanna call
   keys: [ // <@ remember this whole keys[{...}] array can change differently based on accounts & use case, experiment needed as very imp section
      { // AccountMeta : below 3 fields are the only fields a client mentions; later solana runtime will `LOAD` its AccountInfo from AccountMeta. 
         pubkey: walletKeypair.publicKey,
         isSigner: true,
         isWritable: false, // the program which this account is calling is not allowed to modify the accounts data or lamport balance, program can only read from this account
      },
   ],
   data,  // <@ -- REMEMBER to not change this variable name to anything else will start to error
});
```

5. Add this instruction in a transaction :
```typescript
const tx = new Transaction().add(instruction);
```
6. sign & send the tx :
```typescript
// Transaction signature : 
 const sig = await sendAndConfirmTransaction(
     connection,
     tx,
     [walletKeypair]
);

```

----

# TypeScript testing features :

1. Create new wallet :
```typescript
// import { Keypair } from "@solana/web3.js";
const testWallet = Keypair.generate();
console.log("New wallet pubkey:", testWallet.publicKey.toBase58());
```

2. Basic calling a function :
```typescript
 const tx = await program.methods.initialize(new anchor.BN(23), 'purple', ['skiing', 'skydiving', 'biking']).rpc();
```

# Basic Anchor Snippets :

```Rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init_if_needed, // 'init' (tells to init just once) vs init_if_needed (tells to init whenever test rus -- kind of like a testing feature but also requires changes to be made to cargo.toml)
        payer = user, // 'payer' is who pays the rent (lamports)
        space = 8 + Favorites::INIT_SPACE,
        seeds = [b"favorites", user.key().as_ref()],
        bump
    )]
    pub favorites: Account<'info, Favorites>,

    #[account(mut)] // i guess signer allows to modify its accounts lamports to be reduced cuzz he is init Favorites account
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}
```
