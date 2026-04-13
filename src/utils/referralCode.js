export const buildReferralCode = (userId) => {
  if (!userId) return "";
  const raw = userId.toString().replace(/[^a-fA-F0-9]/g, "");
  const code = raw.slice(-8).toUpperCase();
  return code || userId.toString().slice(-8).toUpperCase();
};
