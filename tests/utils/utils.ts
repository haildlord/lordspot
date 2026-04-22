import * as fs from "fs";
import * as path from "path";
import { Keypair } from "@solana/web3.js";

export function loadOrCreateKeypair(filename: string): Keypair {
    const keypath = path.resolve(__dirname, "keys", filename);

    if (!fs.existsSync(path.dirname(keypath))) {
        fs.mkdirSync(path.dirname(keypath), { recursive: true });
    }

    if (fs.existsSync(keypath)) {
        const secretKey = JSON.parse(fs.readFileSync(keypath, "utf-8"));
        console.log(`Loaded persistent keypair: ${filename}`);
        return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    }

    const keypair = Keypair.generate();
    fs.writeFileSync(keypath, JSON.stringify(Array.from(keypair.secretKey)));
    console.log(`Created and saved new persistent keypair: ${filename}`);
    return keypair;
}