import "dotenv/config";
import { ethers } from "ethers";
import axios from "axios";
import fs from "fs";
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from "node-fetch";

const USE_PROXY = process.env.USE_PROXY === "true";
const WALLET_FILE = process.env.WALLET_FILE || "wallets.txt";
const RPC_URL = process.env.RPC_URL;

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) external returns (bool)",
  "function allowance(address,address) view returns (uint256)"
];

const STAKING_ABI = [
  "function stake(uint256 amount) external",
  "function vault() view returns (address)",
  "function token() view returns (address)",
  "function ausd() view returns (address)"
];

const delayFixed = (duration) => {
  console.log(`[⏳] Delay ${(duration / 1000).toFixed(1)} detik`);
  return new Promise(res => setTimeout(res, duration));
};

const ADDRESSES = {
  ATH: process.env.ATH_ADDRESS,
  AI16Z: process.env.AI16Z_ADDRESS,
  USDE: process.env.USDE_ADDRESS,
  VANA: process.env.VANA_ADDRESS,
  VIRTUAL: process.env.VIRTUAL_ADDRESS,
  LULUSD: process.env.LULUSD_ADDRESS,
  AZUSD: process.env.AZUSD_ADDRESS,
  VANAUSD: process.env.VANAUSD_ADDRESS,
  AUSD: process.env.AUSD_ADDRESS,
  VUSD: process.env.VUSD_ADDRESS,
  OG: "0xFBBDAb7684A4Da0CFAE67C5c13fA73402008953e",
  OUSD: "0xD23016Fd7154d9A6F2830Bfb4eA3F3106AAE0E88",
  USD1: "0x16a8A3624465224198d216b33E825BcC3B80abf7"
};

const FAUCET_APIS = {
  ATH: "https://app.x-network.io/maitrix-faucet/faucet",
  USDE: "https://app.x-network.io/maitrix-usde/faucet",
  LULUSD: "https://app.x-network.io/maitrix-lvl/faucet",
  Ai16Z: "https://app.x-network.io/maitrix-ai16z/faucet",
  Virtual: "https://app.x-network.io/maitrix-virtual/faucet",
  Vana: "https://app.x-network.io/maitrix-vana/faucet",
  USD1: "https://app.x-network.io/maitrix-usd1/faucet",
  OG: "https://app.x-network.io/maitrix-0g/faucet"
};

const TOKEN_CONFIG = {
  AUSD: { routerAddress: "0x2cFDeE1d5f04dD235AEA47E1aD2fB66e3A61C13e", selector: "0x1bf6318b", inputTokenAddress: ADDRESSES.ATH },
  VUSD: { routerAddress: "0x3dCACa90A714498624067948C092Dd0373f08265", selector: "0xa6d67510", inputTokenAddress: ADDRESSES.VIRTUAL },
  AZUSD: { routerAddress: "0xB0b53d8B4ef06F9Bbe5db624113C6A5D35bB7522", selector: "0xa6d67510", inputTokenAddress: ADDRESSES.AI16Z },
  VANAUSD: { routerAddress: "0xEfbAE3A68b17a61f21C7809Edfa8Aa3CA7B2546f", selector: "0xa6d67510", inputTokenAddress: ADDRESSES.VANA },
  OUSD: { routerAddress: "0x0b4301877A981e7808A8F4B6E277C376960C7641", selector: "0xa6d67510", inputTokenAddress: ADDRESSES.OG },
};

const STAKING_CONFIG = {
  AZUSD: { stakingAddress: "0xf45Fde3F484C44CC35Bdc2A7fCA3DDDe0C8f252E", tokenAddress: ADDRESSES.AZUSD },
  VANAUSD: { stakingAddress: "0x2608A88219BFB34519f635Dd9Ca2Ae971539ca60", tokenAddress: ADDRESSES.VANAUSD },
  VUSD: { stakingAddress: "0x5bb9Fa02a3DCCDB4E9099b48e8Ba5841D2e59d51", tokenAddress: ADDRESSES.VUSD },
  AUSD: { stakingAddress: "0x054de909723ECda2d119E31583D40a52a332f85c", tokenAddress: ADDRESSES.AUSD },
  LULUSD: { stakingAddress: "0x5De3fBd40D4c3892914c3b67b5B529D776A1483A", tokenAddress: ADDRESSES.LULUSD },
  USDE: { stakingAddress: "0x3988053b7c748023a1aE19a8ED4c1Bf217932bDB", tokenAddress: ADDRESSES.USDE },
  OUSD: { stakingAddress: "0xF8F951DA83dAC732A2dCF207B644E493484047eB", tokenAddress: ADDRESSES.OUSD },
  USD1: { stakingAddress: "0x7799841734Ac448b8634F1c1d7522Bc8887A7bB9", tokenAddress: ADDRESSES.USD1 },
};

async function approveIfNeeded(erc20, spender, amount, wallet, nonceRef) {
  const allowance = await erc20.allowance(wallet.address, spender);
  if (allowance < amount) {
    const tx = await erc20.approve(spender, amount, { nonce: nonceRef.current++ });
    await tx.wait();
    console.log(`[+] Approved ${spender}`);
  }
}

async function claimFaucets(wallet, axiosInstance) {
  for (const token of Object.keys(FAUCET_APIS)) {
    try {
      const res = await axiosInstance.post(FAUCET_APIS[token], { address: wallet.address });
      console.log(`[FAUCET] ${token}: ${res.data.message || res.data.code}`);
    } catch (e) {
      console.log(`[FAUCET] ${token} ERROR: ${e.message}`);
    }
    await delayFixed(5000);
  }
}

async function mintTokens(wallet, provider, axiosInstance, nonceRef) {
  for (const [token, config] of Object.entries(TOKEN_CONFIG)) {
    try {
      const erc20 = new ethers.Contract(config.inputTokenAddress, ERC20_ABI, wallet);
      const decimals = await erc20.decimals();
      const balance = await erc20.balanceOf(wallet.address);
      if (balance <= 0n) continue;

      await approveIfNeeded(erc20, config.routerAddress, balance, wallet, nonceRef);
      const padded = ethers.zeroPadValue(ethers.toBeHex(balance), 32);
      const txData = config.selector + padded.slice(2);

      const tx = await wallet.sendTransaction({
        to: config.routerAddress,
        data: txData,
        gasLimit: 250000,
        nonce: nonceRef.current++
      });

      await tx.wait();
      console.log(`[MINT] ${token} success: ${ethers.formatUnits(balance, decimals)}`);
    } catch (e) {
      console.log(`[MINT] ${token} failed: ${e.reason || e.message}`);
    }
    await delayFixed(5000);
  }
}

async function stakeTokens(wallet, provider, axiosInstance, nonceRef) {
  for (const [token, config] of Object.entries(STAKING_CONFIG)) {
    try {
      const erc20 = new ethers.Contract(config.tokenAddress, ERC20_ABI, wallet);
      const staking = new ethers.Contract(config.stakingAddress, STAKING_ABI, wallet);
      const decimals = await erc20.decimals();
      const balance = await erc20.balanceOf(wallet.address);
      if (balance <= 0n) continue;

      await approveIfNeeded(erc20, config.stakingAddress, balance, wallet, nonceRef);
      try {
        await provider.call({
          to: config.stakingAddress,
          data: staking.interface.encodeFunctionData("stake", [balance]),
          from: wallet.address,
        });
      } catch (e) {
        if (!(e.data?.toLowerCase().startsWith("0xfb8f41b2"))) throw e;
        console.log(`[SIMULATE] ${token}: custom error detected, continue.`);
      }

      const tx = await staking.stake(balance, {
        gasLimit: 300000,
        nonce: nonceRef.current++
      });
      await tx.wait();
      console.log(`[STAKE] ${token} staked: ${ethers.formatUnits(balance, decimals)}`);
    } catch (e) {
      console.log(`[STAKE] ${token} failed: ${e.reason || e.message}`);
    }
    await delayFixed(5000);
  }
}

async function runAll() {
  let lines = [];

  try {
    lines = fs.readFileSync(WALLET_FILE, "utf-8").split('\n').map(x => x.trim()).filter(Boolean);
  } catch (e) {
    console.warn("⚠️ wallets.txt tidak ditemukan atau gagal dibaca.");
    if (process.env.PRIVATE_KEY) {
      lines.push(process.env.PRIVATE_KEY);
      console.log("Menggunakan PRIVATE_KEY dari .env sebagai fallback.");
    } else {
      console.error("❌ Tidak ada wallet ditemukan. Hentikan eksekusi.");
      return;
    }
  }

  for (const [i, line] of lines.entries()) {
    const [privKey, proxyUrl] = line.split(",").map(x => x.trim());
    if (!ethers.isHexString(privKey) || privKey.length !== 66) {
      console.warn(`❌ Private key tidak valid (baris ${i + 1}): ${privKey}`);
      continue;
    }

    const agent = USE_PROXY && proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
    const fetchFn = agent ? (url, options) => fetch(url, { ...options, agent }) : undefined;
    const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, fetchFn);
    const wallet = new ethers.Wallet(privKey, provider);
    const axiosInstance = USE_PROXY && proxyUrl
      ? axios.create({ proxy: false, httpsAgent: agent })
      : axios;

    const nonceRef = { current: await provider.getTransactionCount(wallet.address) };

    console.log(`\n=== Wallet #${i + 1}: ${wallet.address} ===`);
    await claimFaucets(wallet, axiosInstance);
    await mintTokens(wallet, provider, axiosInstance, nonceRef);
    await stakeTokens(wallet, provider, axiosInstance, nonceRef);
    console.log(`[✓] Wallet ${i + 1} selesai\n`);
  }

  console.log("✅ Semua wallet selesai!");
}

async function startLoop() {
  const twentyFourHours = 24 * 60 * 60 * 1000;
  let initialRunTime = Date.now();

  while (true) {
    console.log(`\n⏱️ Menjalankan ulang bot (${new Date().toLocaleString()})\n`);
    await runAll();

    initialRunTime += twentyFourHours;
    const delay = initialRunTime - Date.now();

    if (delay > 0) {
      console.log(`🕒 Menunggu ${(delay / 1000 / 60 / 60).toFixed(2)} jam untuk menjalankan ulang...`);
      await delayFixed(delay);
    } else {
      console.warn("⚠️ Terlambat dari jadwal, menunggu 24 jam dari sekarang.");
      initialRunTime = Date.now();
      await delayFixed(twentyFourHours);
    }
  }
}

startLoop();
