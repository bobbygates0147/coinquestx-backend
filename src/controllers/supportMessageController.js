import mongoose from "mongoose";
import SupportThread from "../models/SupportThread.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  DIRECT_MESSAGE_REQUIRED_PLANS,
  getDirectMessageAccessDeniedMessage,
  hasDirectMessageAccess,
  normalizePlanName,
} from "../utils/subscriptionAccess.js";
import {
  applySupportSla,
  computeSlaTargetAt,
  normalizeSupportCategory,
  normalizeSupportPriority,
} from "../utils/supportSla.js";
import { sendUserNotificationEmail } from "../utils/notificationService.js";

const MAX_THREAD_LIMIT = 120;
const DEFAULT_THREAD_LIMIT = 60;

const normalizeLimit = (value, fallback = DEFAULT_THREAD_LIMIT) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(MAX_THREAD_LIMIT, parsed);
};

const normalizeStatusFilter = (value) => {
  const normalized = `${value || ""}`.trim().toLowerCase();
  if (!normalized) return "";
  return ["open", "pending", "resolved", "closed"].includes(normalized)
    ? normalized
    : "";
};

const normalizeSubject = (value) => {
  const text = `${value || ""}`.trim();
  return text || "Support Request";
};

const normalizeMessageText = (value) => `${value || ""}`.trim();

const mapThreadSummary = (thread) => {
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const latestMessage = messages[messages.length - 1] || null;

  return {
    id: thread?._id?.toString() || "",
    user: thread?.user
      ? {
          id:
            typeof thread.user === "object" && thread.user?._id
              ? thread.user._id.toString()
              : thread.user.toString(),
          firstName:
            typeof thread.user === "object" ? thread.user.firstName || "" : "",
          lastName:
            typeof thread.user === "object" ? thread.user.lastName || "" : "",
          email: typeof thread.user === "object" ? thread.user.email || "" : "",
        }
      : null,
    subject: thread?.subject || "Support Request",
    category: thread?.category || "general",
    priority: thread?.priority || "normal",
    status: thread?.status || "open",
    slaStatus: thread?.slaStatus || "on_track",
    slaTargetAt: thread?.slaTargetAt || null,
    lastReplyAt: thread?.lastReplyAt || null,
    closedAt: thread?.closedAt || null,
    unreadForUser: Number(thread?.unreadForUser) || 0,
    unreadForAdmin: Number(thread?.unreadForAdmin) || 0,
    lastMessageAt: thread?.lastMessageAt || thread?.updatedAt || thread?.createdAt,
    latestMessage: latestMessage
      ? {
          id: latestMessage._id?.toString() || "",
          senderRole: latestMessage.senderRole || "user",
          text: latestMessage.text || "",
          createdAt: latestMessage.createdAt || null,
        }
      : null,
    messageCount: messages.length,
    createdAt: thread?.createdAt || null,
    updatedAt: thread?.updatedAt || null,
  };
};

const mapMessage = (message) => ({
  id: message?._id?.toString() || "",
  senderRole: message?.senderRole || "user",
  sender: message?.sender?.toString ? message.sender.toString() : "",
  text: message?.text || "",
  readByUser: Boolean(message?.readByUser),
  readByAdmin: Boolean(message?.readByAdmin),
  createdAt: message?.createdAt || null,
});

const mapThreadDetails = (thread) => ({
  ...mapThreadSummary(thread),
  messages: (Array.isArray(thread?.messages) ? thread.messages : []).map(mapMessage),
});

const markAdminMessagesAsReadByUser = (thread) => {
  let touched = false;
  thread.messages.forEach((message) => {
    if (message.senderRole === "admin" && !message.readByUser) {
      message.readByUser = true;
      touched = true;
    }
  });

  if ((thread.unreadForUser || 0) > 0) {
    thread.unreadForUser = 0;
    touched = true;
  }

  return touched;
};

const markUserMessagesAsReadByAdmin = (thread) => {
  let touched = false;
  thread.messages.forEach((message) => {
    if (message.senderRole === "user" && !message.readByAdmin) {
      message.readByAdmin = true;
      touched = true;
    }
  });

  if ((thread.unreadForAdmin || 0) > 0) {
    thread.unreadForAdmin = 0;
    touched = true;
  }

  return touched;
};

export const listUserThreads = asyncHandler(async (req, res) => {
  const limit = normalizeLimit(req.query.limit, DEFAULT_THREAD_LIMIT);
  const threads = await SupportThread.find({ user: req.user._id })
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .limit(limit)
    .lean();

  res.json({
    success: true,
    data: threads.map((thread) => mapThreadSummary(applySupportSla(thread))),
    generatedAt: new Date().toISOString(),
  });
});

export const getUserThread = asyncHandler(async (req, res) => {
  const thread = await SupportThread.findOne({
    _id: req.params.threadId,
    user: req.user._id,
  });

  if (!thread) {
    return res.status(404).json({
      success: false,
      message: "Message thread not found",
    });
  }

  const touched = markAdminMessagesAsReadByUser(thread);
  applySupportSla(thread);
  if (touched) {
    await thread.save();
  }

  res.json({
    success: true,
    data: mapThreadDetails(thread),
  });
});

export const sendUserMessage = asyncHandler(async (req, res) => {
  const currentPlan = normalizePlanName(req.user?.subscriptionPlan || "Basic");
  if (!hasDirectMessageAccess(currentPlan)) {
    return res.status(403).json({
      success: false,
      message: getDirectMessageAccessDeniedMessage(currentPlan),
      currentPlan,
      requiredPlans: DIRECT_MESSAGE_REQUIRED_PLANS,
    });
  }

  const text = normalizeMessageText(req.body.message || req.body.body);
  const subject = normalizeSubject(req.body.subject);
  const providedThreadId = `${req.body.threadId || ""}`.trim();
  const category = normalizeSupportCategory(req.body.category);
  const priority = normalizeSupportPriority(req.body.priority);

  if (!text) {
    return res.status(400).json({
      success: false,
      message: "Message text is required",
    });
  }

  let thread = null;
  if (providedThreadId) {
    if (!mongoose.Types.ObjectId.isValid(providedThreadId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid threadId",
      });
    }

    thread = await SupportThread.findOne({
      _id: providedThreadId,
      user: req.user._id,
    });

    if (!thread) {
      return res.status(404).json({
        success: false,
        message: "Message thread not found",
      });
    }
  } else {
    thread = new SupportThread({
      user: req.user._id,
      subject,
      category,
      priority,
      status: "open",
      unreadForAdmin: 0,
      unreadForUser: 0,
      lastMessageAt: new Date(),
      slaTargetAt: computeSlaTargetAt(priority),
      messages: [],
    });
  }

  if (!thread.subject) {
    thread.subject = subject;
  }
  if (req.body.category) {
    thread.category = category;
  }
  if (req.body.priority) {
    thread.priority = priority;
  }
  if (thread.status === "closed" || thread.status === "resolved") {
    thread.status = "open";
  }

  thread.messages.push({
    senderRole: "user",
    sender: req.user._id,
    text,
    readByUser: true,
    readByAdmin: false,
    createdAt: new Date(),
  });

  thread.lastMessageAt = new Date();
  thread.lastReplyAt = null;
  thread.slaTargetAt = computeSlaTargetAt(thread.priority || priority, new Date());
  thread.unreadForAdmin = (Number(thread.unreadForAdmin) || 0) + 1;
  thread.unreadForUser = 0;
  applySupportSla(thread);

  await thread.save();
  await thread.populate("user", "firstName lastName email");

  const latestMessage = thread.messages[thread.messages.length - 1];

  if (!providedThreadId && thread.user?.email) {
    await sendUserNotificationEmail({
      user: thread.user,
      type: "support",
      subject: `Support request received: ${thread.subject || "Support Request"}`,
      headline: "Your support request is in the queue",
      intro:
        "CoinQuestX received your support request. An admin will review it and reply inside Messages.",
      bullets: [
        `Ticket: ${thread.subject || "Support Request"}`,
        `Priority: ${thread.priority || "normal"}`,
        `Category: ${thread.category || "general"}`,
      ],
      metadata: {
        threadId: thread._id.toString(),
      },
    });
  }

  res.status(201).json({
    success: true,
    data: {
      thread: mapThreadSummary(thread),
      message: mapMessage(latestMessage),
    },
  });
});

export const listAdminThreads = asyncHandler(async (req, res) => {
  const limit = normalizeLimit(req.query.limit, DEFAULT_THREAD_LIMIT);
  const statusFilter = normalizeStatusFilter(req.query.status);
  const priorityFilter = normalizeSupportPriority(req.query.priority, "");
  const query = {};
  if (statusFilter) query.status = statusFilter;
  if (priorityFilter) query.priority = priorityFilter;

  const threads = await SupportThread.find(query)
    .populate("user", "firstName lastName email")
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .limit(limit);

  const summaries = threads.map((thread) =>
    mapThreadSummary(applySupportSla(thread))
  );
  const unreadThreads = summaries.filter((thread) => thread.unreadForAdmin > 0).length;

  res.json({
    success: true,
    data: summaries,
    totals: {
      totalThreads: summaries.length,
      unreadThreads,
    },
    generatedAt: new Date().toISOString(),
  });
});

export const getAdminThread = asyncHandler(async (req, res) => {
  const thread = await SupportThread.findById(req.params.threadId).populate(
    "user",
    "firstName lastName email"
  );

  if (!thread) {
    return res.status(404).json({
      success: false,
      message: "Message thread not found",
    });
  }

  const touched = markUserMessagesAsReadByAdmin(thread);
  applySupportSla(thread);
  if (touched) {
    await thread.save();
  }

  res.json({
    success: true,
    data: mapThreadDetails(thread),
  });
});

export const replyAdminThread = asyncHandler(async (req, res) => {
  const text = normalizeMessageText(req.body.message || req.body.body);
  if (!text) {
    return res.status(400).json({
      success: false,
      message: "Reply text is required",
    });
  }

  const thread = await SupportThread.findById(req.params.threadId).populate(
    "user",
    "firstName lastName email"
  );

  if (!thread) {
    return res.status(404).json({
      success: false,
      message: "Message thread not found",
    });
  }

  thread.messages.push({
    senderRole: "admin",
    sender: req.user._id,
    text,
    readByUser: false,
    readByAdmin: true,
    createdAt: new Date(),
  });

  thread.lastMessageAt = new Date();
  thread.lastReplyAt = new Date();
  thread.assignedAdmin = req.user._id;
  thread.unreadForUser = (Number(thread.unreadForUser) || 0) + 1;
  thread.unreadForAdmin = 0;
  if (thread.status === "closed") {
    thread.status = "pending";
  }
  if (thread.status === "open") {
    thread.status = "pending";
  }
  applySupportSla(thread);

  await thread.save();
  const latestMessage = thread.messages[thread.messages.length - 1];

  if (thread.user?.email) {
    await sendUserNotificationEmail({
      user: thread.user,
      type: "support",
      subject: `Admin replied: ${thread.subject || "Support Request"}`,
      headline: "You have a new support reply",
      intro:
        "A CoinQuestX admin replied to one of your support tickets. Open Messages in your dashboard to continue the conversation.",
      bullets: [
        `Ticket: ${thread.subject || "Support Request"}`,
        `Priority: ${thread.priority || "normal"}`,
        `Status: ${thread.status || "pending"}`,
      ],
      metadata: {
        threadId: thread._id.toString(),
      },
    });
  }

  res.status(201).json({
    success: true,
    data: {
      thread: mapThreadSummary(thread),
      message: mapMessage(latestMessage),
    },
  });
});

export const updateAdminThreadStatus = asyncHandler(async (req, res) => {
  const status = normalizeStatusFilter(req.body.status);
  const priority = req.body.priority
    ? normalizeSupportPriority(req.body.priority)
    : "";
  const category = req.body.category
    ? normalizeSupportCategory(req.body.category)
    : "";

  if (!status && !priority && !category) {
    return res.status(400).json({
      success: false,
      message: "Provide a valid status, priority, or category value",
    });
  }

  const thread = await SupportThread.findById(req.params.threadId).populate(
    "user",
    "firstName lastName email"
  );
  if (!thread) {
    return res.status(404).json({
      success: false,
      message: "Message thread not found",
    });
  }

  if (status) {
    thread.status = status;
  }
  if (priority) {
    thread.priority = priority;
    if (!thread.lastReplyAt) {
      thread.slaTargetAt = computeSlaTargetAt(priority, thread.createdAt || new Date());
    }
  }
  if (category) {
    thread.category = category;
  }
  applySupportSla(thread);
  await thread.save();

  res.json({
    success: true,
    data: mapThreadSummary(thread),
  });
});
