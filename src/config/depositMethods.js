import { env } from "./env.js";

export const depositMethods = [
  {
    id: "btc",
    currencyCode: "BTC",
    currencyName: "Bitcoin",
    network: "Bitcoin",
    walletAddress: env.BTC_WALLET_ADDRESS,
  },
  {
    id: "eth",
    currencyCode: "ETH",
    currencyName: "Ethereum",
    network: "Ethereum",
    walletAddress: env.ETH_WALLET_ADDRESS,
  },
  {
    id: "sol",
    currencyCode: "SOL",
    currencyName: "Solana",
    network: "Solana",
    walletAddress: env.SOL_WALLET_ADDRESS,
  },
  {
    id: "base",
    currencyCode: "BASE",
    currencyName: "Base",
    network: "Base",
    walletAddress: env.BASE_WALLET_ADDRESS,
  },
  {
    id: "sui",
    currencyCode: "SUI",
    currencyName: "Sui",
    network: "Sui",
    walletAddress: env.SUI_WALLET_ADDRESS,
  },
  {
    id: "pol",
    currencyCode: "POL",
    currencyName: "Polygon",
    network: "Polygon",
    walletAddress: env.POL_WALLET_ADDRESS,
  },
];
