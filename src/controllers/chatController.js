import { asyncHandler } from "../utils/asyncHandler.js";
import { getUserChatState } from "../utils/chatState.js";

const BASE_TOKEN_PRICES = {
  BTC: 62850,
  ETH: 3450,
  SOL: 150,
  ADA: 0.48,
  DOGE: 0.15,
};

const PAGE_CONTEXT = {
  "/dashboard": {
    title: "Dashboard",
    summary: "balance, KYC status, active trades, performance, and quick actions",
    actions: [
      { label: "Open Dashboard", to: "/Dashboard" },
      { label: "Open Deposits", to: "/Deposits", requiresKyc: true },
      { label: "Open Place Trade", to: "/PlaceTrade", requiresKyc: true },
    ],
  },
  "/deposits": {
    title: "Deposits",
    summary: "funding methods, wallet instructions, and deposit progress",
    actions: [
      { label: "Open Deposits", to: "/Deposits", requiresKyc: true },
      { label: "Open Payment Proof", to: "/PaymentProof" },
      { label: "Open Transactions", to: "/Transactions" },
    ],
  },
  "/withdrawal": {
    title: "Withdrawal",
    summary: "payout requests and withdrawal tracking",
    actions: [
      { label: "Open Withdrawal", to: "/Withdrawal", requiresKyc: true },
      { label: "Open Transactions", to: "/Transactions" },
      { label: "Open Help", to: "/Help" },
    ],
  },
  "/placetrade": {
    title: "Place Trade",
    summary: "manual trading, trade direction, and execution controls",
    actions: [
      { label: "Open Place Trade", to: "/PlaceTrade", requiresKyc: true },
      { label: "Open Trades ROI", to: "/TradesRoi", requiresKyc: true },
      { label: "Open Deposits", to: "/Deposits", requiresKyc: true },
    ],
  },
  "/messages": {
    title: "Messages",
    summary: "direct admin conversations and unread thread tracking",
    actions: [
      { label: "Open Messages", to: "/Messages" },
      { label: "Open Help", to: "/Help" },
      { label: "Open Subscription", to: "/Subscription", requiresKyc: true },
    ],
  },
  "/kyc-verification": {
    title: "KYC Verification",
    summary: "identity verification and feature unlock status",
    actions: [
      { label: "Verify KYC", to: "/kyc-verification" },
      { label: "Open Dashboard", to: "/Dashboard" },
      { label: "Open Help", to: "/Help" },
    ],
  },
};

const normalizePath = (value = "") => {
  const trimmed = `${value || ""}`.trim().replace(/\/+$/, "");
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed.toLowerCase() : `/${trimmed}`.toLowerCase();
};

const unique = (items = []) =>
  items.filter((item, index) => item && items.indexOf(item) === index);

const action = (label, to, extra = {}) => ({ type: "navigate", label, to, ...extra });

const suggestions = (...items) => unique(items.flat().filter(Boolean)).slice(0, 4);

const resolveSymbol = (query = "") => {
  const lowered = `${query}`.toLowerCase();
  if (lowered.includes("bitcoin") || lowered.includes("btc")) return "BTC";
  if (lowered.includes("ethereum") || lowered.includes("eth")) return "ETH";
  if (lowered.includes("solana") || lowered.includes("sol")) return "SOL";
  if (lowered.includes("cardano") || lowered.includes("ada")) return "ADA";
  if (lowered.includes("dogecoin") || lowered.includes("doge")) return "DOGE";
  return "BTC";
};

const computeSyntheticPrice = (query) => {
  const symbol = resolveSymbol(query);
  const base = BASE_TOKEN_PRICES[symbol] || 1000;
  const seed = `${query}${symbol}`.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  const delta = Math.sin((Math.floor(Date.now() / 60000) + seed) * 0.37) * 0.028;
  return {
    symbol,
    price: base * (1 + delta),
    changePct: delta * 100,
  };
};

const getNextStep = (state) => {
  if (!state.isAuthenticated) {
    return {
      reply: "Next step: create an account, sign in, then complete KYC before funding or trading.",
      actions: [
        action("Create Account", "/SignUpPage"),
        action("Open Login", "/LoginPage"),
      ],
      suggestions: suggestions(
        "How do I register an account?",
        "How do I verify my account (KYC)?",
        "What can I do on the dashboard?"
      ),
    };
  }

  if (!state.kycVerified) {
    return {
      reply: `Next step: complete KYC. Your current KYC status is ${state.kycStatus}.`,
      actions: [
        action("Verify KYC", "/kyc-verification"),
        action("Open Dashboard", "/Dashboard"),
        action("Open Help", "/Help"),
      ],
      suggestions: suggestions(
        "How does KYC work here?",
        "What happens after approval?",
        "Where do I make a deposit?"
      ),
    };
  }

  if (state.deposits.completedCount === 0) {
    return {
      reply: "Next step: fund your wallet from Deposits, then track the result in Transactions or submit Payment Proof if needed.",
      actions: [
        action("Open Deposits", "/Deposits", { requiresKyc: true }),
        action("Open Payment Proof", "/PaymentProof"),
        action("Open Transactions", "/Transactions"),
      ],
      suggestions: suggestions(
        "Summarize my deposit status",
        "How do I submit payment proof?",
        "Where can I see my transactions?"
      ),
    };
  }

  if (state.trading.activeCount === 0) {
    return {
      reply: "Next step: choose an earning or trading module. Place Trade, Copy Trade, Stake, Mining, Bots, and Real Estate are all available from your account.",
      actions: [
        action("Open Place Trade", "/PlaceTrade", { requiresKyc: true }),
        action("Open Copy Trade", "/MyTraders", { requiresKyc: true }),
        action("Open Stake", "/Stake", { requiresKyc: true }),
      ],
      suggestions: suggestions(
        "How does place trade work?",
        "How does copy trade work?",
        "How does staking work here?"
      ),
    };
  }

  return {
    reply: "Next step: review performance in Trades ROI, monitor transactions, or grow through referrals and support.",
    actions: [
      action("Open Trades ROI", "/TradesRoi", { requiresKyc: true }),
      action("Open Referrals", "/Referrals"),
      action("Open Transactions", "/Transactions"),
    ],
    suggestions: suggestions(
      "Show my account pulse",
      "Summarize my referrals",
      "Do I have unread support replies?"
    ),
  };
};

const buildAccountPulseReply = (state) => ({
  topic: "account_pulse",
  reply: state.isAuthenticated
    ? `Account pulse:\n- Balance: ${state.balanceText}\n- Plan: ${state.plan}\n- KYC: ${
        state.kycVerified ? "verified" : state.kycStatus
      }\n- Pending deposits: ${state.deposits.pendingCount} (${state.deposits.pendingAmountText})\n- Pending withdrawals: ${
        state.withdrawals.pendingCount
      } (${state.withdrawals.pendingAmountText})\n- Active trades: ${state.trading.activeCount}\n- Gross revenue: ${state.grossRevenueText}\n- Latest transaction: ${
        state.transactionSummary.latestText
      }`
    : "Sign in to view your live balance, KYC status, pending funding actions, and active products.",
  actions: state.isAuthenticated
    ? [
        action("Open Dashboard", "/Dashboard"),
        state.kycVerified
          ? action("Open Deposits", "/Deposits", { requiresKyc: true })
          : action("Verify KYC", "/kyc-verification"),
        action("Open Transactions", "/Transactions"),
      ]
    : [action("Create Account", "/SignUpPage"), action("Open Login", "/LoginPage")],
  suggestions: state.isAuthenticated
    ? suggestions("What should I do next?", "Summarize my deposit status", "Summarize my active trades")
    : suggestions("How do I register an account?", "How do I verify my account (KYC)?"),
});

const buildFundingReply = (type, state) => {
  if (!state.isAuthenticated) {
    return {
      topic: type,
      reply: `${type === "deposit" ? "Deposits" : "Withdrawals"} are available after sign in, and KYC unlocks the full wallet flow.`,
      actions: [action("Create Account", "/SignUpPage"), action("Open Login", "/LoginPage")],
      suggestions: suggestions("How do I register an account?", "How does KYC work here?"),
    };
  }

  if (!state.kycVerified) {
    return {
      topic: type,
      reply: `${type === "deposit" ? "Deposits" : "Withdrawals"} are blocked until KYC is verified. Your current KYC status is ${state.kycStatus}.`,
      actions: [action("Verify KYC", "/kyc-verification"), action("Open Help", "/Help")],
      suggestions: suggestions("How does KYC work here?", "What happens after approval?", "Show my account pulse"),
    };
  }

  const isDeposit = type === "deposit";
  const summary = isDeposit ? state.deposits : state.withdrawals;
  return {
    topic: type,
    reply: `${isDeposit ? "Deposit" : "Withdrawal"} snapshot:\n- Pending: ${summary.pendingCount} (${summary.pendingAmountText})\n- Completed: ${summary.completedCount} (${summary.completedAmountText})${
      isDeposit ? `\n- Payment proof pending review: ${state.paymentProofs.pendingCount}` : ""
    }`,
    actions: isDeposit
      ? [
          action("Open Deposits", "/Deposits", { requiresKyc: true }),
          action("Open Payment Proof", "/PaymentProof"),
          action("Open Transactions", "/Transactions"),
        ]
      : [
          action("Open Withdrawal", "/Withdrawal", { requiresKyc: true }),
          action("Open Transactions", "/Transactions"),
          action("Open Help", "/Help"),
        ],
    suggestions: suggestions(
      "Show my account pulse",
      "Where can I see my transactions?",
      isDeposit ? "How do I submit payment proof?" : "How do I contact support?"
    ),
  };
};

const buildTradingReply = (topic, state) => ({
  topic,
  reply: !state.isAuthenticated
    ? "Sign in first, then complete KYC to unlock trading modules."
    : !state.kycVerified
    ? `Trading is gated until KYC is verified. Your current KYC status is ${state.kycStatus}.`
    : `Trading snapshot:\n- Active spot trades: ${state.trading.activeSpot}\n- Active place trades: ${state.trading.activePlace}\n- Active copy trades: ${state.trading.activeCopy}\n- Trade PnL: ${state.trading.pnlText}\n- Copy trade capital: ${state.trading.copyInvestedText}`,
  actions: !state.isAuthenticated
    ? [action("Create Account", "/SignUpPage"), action("Open Login", "/LoginPage")]
    : !state.kycVerified
    ? [action("Verify KYC", "/kyc-verification"), action("Open Help", "/Help")]
    : [
        action("Open Place Trade", "/PlaceTrade", { requiresKyc: true }),
        action("Open Copy Trade", "/MyTraders", { requiresKyc: true }),
        action("Open Trades ROI", "/TradesRoi", { requiresKyc: true }),
      ],
  suggestions: suggestions("What should I do next?", "How does place trade work?", "How does copy trade work?"),
});

const buildProductsReply = (topic, state) => ({
  topic,
  reply: state.isAuthenticated
    ? `Product snapshot:\n- Active subscriptions: ${state.products.subscriptionCount}\n- Active signals: ${state.products.signalCount}\n- Active bots: ${state.products.botCount} (${state.products.botBudgetText})\n- Active mining runs: ${state.products.miningCount} (${state.products.miningRewardText})\n- Active stakes: ${state.products.stakeCount} (${state.products.stakePrincipalText})\n- Active real estate entries: ${state.products.realEstateCount} (${state.products.realEstateAmountText})`
    : "Sign in to sync subscriptions, signals, bots, mining, staking, and real estate with your account.",
  actions: state.isAuthenticated
    ? [
        action("Open Subscription", "/Subscription", { requiresKyc: true }),
        action("Open Buy Bots", "/BuyBots", { requiresKyc: true }),
        action("Open Stake", "/Stake", { requiresKyc: true }),
      ]
    : [action("Create Account", "/SignUpPage"), action("Open Login", "/LoginPage")],
  suggestions: suggestions("How does staking work here?", "How does mining work here?", "What should I do next?"),
});

const buildSupportReply = (state) => ({
  topic: "support",
  reply: !state.isAuthenticated
    ? "Sign in to access help and support modules."
    : state.canMessageAdmin
    ? `Support snapshot:\n- Open threads: ${state.support.threadCount}\n- Unread replies: ${state.support.unreadCount}\n- Latest subject: ${state.support.latestSubject || "No thread yet"}`
    : `Your current plan is ${state.plan}. Direct admin messaging is reserved for Platinum and Elite. Help Center is still available now.`,
  actions: !state.isAuthenticated
    ? [action("Create Account", "/SignUpPage"), action("Open Login", "/LoginPage")]
    : state.canMessageAdmin
    ? [action("Open Messages", "/Messages"), action("Open Help", "/Help"), action("Open Dashboard", "/Dashboard")]
    : [action("Open Help", "/Help"), action("Open Subscription", "/Subscription", { requiresKyc: true }), action("Open Dashboard", "/Dashboard")],
  suggestions: suggestions("Do I have unread support replies?", "What does my plan allow?", "How do I contact support?"),
});

const buildOverviewReply = (state) => ({
  topic: "project_overview",
  reply: `CoinQuestX modules:\n- Wallet: Deposits, Withdrawal, Payment Proof, Transactions\n- Trading: Place Trade, Copy Trade, Trades ROI, Buy Crypto\n- Products: Subscription, Daily Signal, Buy Bots, Mining, Stake, Real Estate\n- Growth and support: Referrals, Messages, Help\n${
    state.isAuthenticated
      ? `\nLive account sync:\n- Active trades: ${state.trading.activeCount}\n- Active products: ${
          state.products.subscriptionCount +
          state.products.signalCount +
          state.products.botCount +
          state.products.miningCount +
          state.products.stakeCount +
          state.products.realEstateCount
        }\n- Referrals: ${state.referrals.activeCount}/${state.referrals.totalCount}\n- Support unread: ${state.support.unreadCount}`
      : ""
  }`,
  actions: state.isAuthenticated
    ? [action("Open Dashboard", "/Dashboard"), action("Open Referrals", "/Referrals"), action("Open Help", "/Help")]
    : [action("Create Account", "/SignUpPage"), action("Open Login", "/LoginPage")],
  suggestions: suggestions("Show my account pulse", "What should I do next?", "How do referrals work?"),
});

const buildPageReply = (currentPath) => {
  const page = PAGE_CONTEXT[currentPath] || PAGE_CONTEXT["/dashboard"];
  return {
    topic: "navigation",
    reply: `You are on ${page.title}. This page is for ${page.summary}.`,
    actions: page.actions.map((item) => action(item.label, item.to, item.requiresKyc ? { requiresKyc: true } : {})),
    suggestions: suggestions("What should I do next?", "Show my account pulse", "How do I contact support?"),
  };
};

const buildMarketReply = (query) => {
  const snapshot = computeSyntheticPrice(query);
  const direction = snapshot.changePct >= 0 ? "up" : "down";
  return {
    topic: "market",
    reply: `${snapshot.symbol} is ${snapshot.price.toFixed(2)} USD (${Math.abs(snapshot.changePct).toFixed(2)}% ${direction} in 24h). Use Assets for the market board and dashboard routes for account actions.`,
    actions: [action("Open Assets", "/Assets"), action("Open Dashboard", "/Dashboard")],
    suggestions: suggestions("Show my account pulse", "What should I do next?", "How does place trade work?"),
  };
};

const buildResponse = ({ query, state, currentPath }) => {
  const lowered = `${query || ""}`.toLowerCase().trim();
  if (!lowered) return buildOverviewReply(state);
  if (/where am i|this page|current page/.test(lowered)) return buildPageReply(currentPath);
  if (/what should i do next|what next|next step/.test(lowered)) {
    const next = getNextStep(state);
    return { topic: "next_step", reply: next.reply, actions: next.actions, suggestions: next.suggestions };
  }
  if (/register|sign up|signup|create account/.test(lowered)) {
    return {
      topic: "register",
      reply: "Open Sign Up, create your account, sign in, then complete KYC before funding or trading.",
      actions: [action("Create Account", "/SignUpPage"), action("Open Login", "/LoginPage")],
      suggestions: suggestions("How do I verify my account (KYC)?", "What can I do on the dashboard?"),
    };
  }
  if (/login|log in|sign in|forgot password|reset password/.test(lowered)) {
    return {
      topic: "login",
      reply: "Open Login to access your account. If you forgot your password, use the reset flow first.",
      actions: [action("Open Login", "/LoginPage"), action("Reset Password", "/ForgotPassword")],
      suggestions: suggestions("How do I register an account?", "How do I verify my account (KYC)?"),
    };
  }
  if (/kyc|verify account|identity verification/.test(lowered)) return {
    topic: "kyc",
    reply: state.isAuthenticated
      ? `KYC and account verification are the same flow here. Your current KYC status is ${state.kycStatus}.`
      : "KYC unlocks deposits, withdrawals, and trading after sign in.",
    actions: [action("Verify KYC", "/kyc-verification"), action("Open Help", "/Help"), action("Open Dashboard", "/Dashboard")],
    suggestions: suggestions("What happens after approval?", "Where do I make a deposit?", "What should I do next?"),
  };
  if (/deposit|fund account|wallet address/.test(lowered)) return buildFundingReply("deposit", state);
  if (/withdraw|cash app|paypal|bank transfer|cash out/.test(lowered)) return buildFundingReply("withdrawal", state);
  if (/payment proof|proof of payment|receipt/.test(lowered)) return {
    topic: "payment_proof",
    reply: `Payment Proof tracks uploaded deposit evidence. Pending reviews: ${state.paymentProofs?.pendingCount || 0}. Approved proofs: ${state.paymentProofs?.approvedCount || 0}.`,
    actions: [action("Open Payment Proof", "/PaymentProof"), action("Open Transactions", "/Transactions"), action("Open Deposits", "/Deposits", { requiresKyc: true })],
    suggestions: suggestions("Summarize my deposit status", "Where can I see my transactions?", "How do I contact support?"),
  };
  if (/transactions|history|latest transaction/.test(lowered)) return {
    topic: "transactions",
    reply: `Transactions snapshot:\n- Pending: ${state.transactionSummary.pending}\n- Completed: ${state.transactionSummary.completed}\n- Latest: ${state.transactionSummary.latestText}`,
    actions: [action("Open Transactions", "/Transactions"), action("Open Deposits", "/Deposits", { requiresKyc: true }), action("Open Withdrawal", "/Withdrawal", { requiresKyc: true })],
    suggestions: suggestions("Summarize my deposit status", "Summarize my withdrawal status", "Show my account pulse"),
  };
  if (/copy trade|copy trader|my traders|my copy traders/.test(lowered)) return buildTradingReply("copy_trade", state);
  if (/trade|vip trades|forex|take profit|stop loss|lot size/.test(lowered)) return buildTradingReply("trade", state);
  if (/subscription|signal|bot|mining|stake|real estate|realestate|buy bot|daily signal/.test(lowered)) return buildProductsReply("products", state);
  if (/referral|invite|commission/.test(lowered)) return {
    topic: "referrals",
    reply: `Referral snapshot:\n- Total referrals: ${state.referrals?.totalCount || 0}\n- Active referrals: ${state.referrals?.activeCount || 0}\n- Earnings: ${state.referrals?.earningsText || "$0.00"}`,
    actions: [action("Open Referrals", "/Referrals"), action("Open Dashboard", "/Dashboard"), action("Open Help", "/Help")],
    suggestions: suggestions("What should I do next?", "Show my account pulse", "How do I contact support?"),
  };
  if (/messages|support|help|contact admin|customer care/.test(lowered)) return buildSupportReply(state);
  if (/dashboard|overview|portfolio|balance|pulse|account status/.test(lowered)) return buildAccountPulseReply(state);
  if (/project|modules|features|sections|navigation/.test(lowered)) return buildOverviewReply(state);
  if (/price|market|news|btc|bitcoin|eth|ethereum|sol|solana|ada|doge/.test(lowered)) return buildMarketReply(lowered);
  const fallback = getNextStep(state);
  return {
    topic: "project_help",
    reply: `${buildOverviewReply(state).reply}\n\n${fallback.reply}`,
    actions: fallback.actions,
    suggestions: fallback.suggestions,
  };
};

export const getChatReply = asyncHandler(async (req, res) => {
  const state = await getUserChatState(req.user || null);
  const currentPath = normalizePath(req.body.currentPath || "/");
  const response = buildResponse({
    query: req.body.message || "",
    state,
    currentPath,
  });

  res.json({
    success: true,
    data: {
      ...response,
      isAuthenticated: state.isAuthenticated,
      timestamp: new Date().toISOString(),
    },
  });
});
