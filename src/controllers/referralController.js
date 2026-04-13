import Referral from "../models/Referral.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { buildReferralCode } from "../utils/referralCode.js";

const normalizeName = (user) => {
  if (!user) return "";
  const first = user.firstName || "";
  const last = user.lastName || "";
  return `${first} ${last}`.trim();
};

export const getReferralOverview = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user.referralCode) {
    user.referralCode = buildReferralCode(user._id);
    await user.save();
  }

  const referrals = await Referral.find({ referrer: user._id })
    .populate("referred", "firstName lastName email createdAt")
    .sort({ createdAt: -1 });

  const referralList = referrals.map((referral) => ({
    id: referral._id.toString(),
    email:
      referral.referred?.email ||
      referral.referredEmail ||
      "Pending user",
    name:
      normalizeName(referral.referred) ||
      (referral.referredEmail ? "" : "Pending"),
    date: referral.createdAt,
    status: referral.status,
    earnings: referral.rewardAmount || 0,
  }));

  const totalReferrals = referrals.length;
  const activeReferrals = referrals.filter(
    (referral) => referral.status === "Active"
  ).length;
  const totalEarnings = referrals.reduce(
    (sum, referral) => sum + (referral.rewardAmount || 0),
    0
  );

  const rewardHistory = referrals
    .filter((referral) => (referral.rewardAmount || 0) > 0)
    .map((referral) => ({
      id: referral._id.toString(),
      amount: referral.rewardAmount || 0,
      date: referral.createdAt,
      status: referral.rewardStatus,
      description: `Referral reward for ${
        referral.referred?.email || referral.referredEmail || "user"
      }`,
    }));

  const baseUrl = env.FRONTEND_URL.replace(/\/+$/, "");
  const referralLink = `${baseUrl}/SignUpPage?ref=${user.referralCode}`;

  res.json({
    success: true,
    data: {
      referralCode: user.referralCode,
      referralLink,
      stats: {
        total: totalReferrals,
        active: activeReferrals,
        earnings: totalEarnings,
      },
      referrals: referralList,
      rewards: rewardHistory,
    },
  });
});
