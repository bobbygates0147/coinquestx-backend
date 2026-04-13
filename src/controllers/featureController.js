import { asyncHandler } from "../utils/asyncHandler.js";

export const createFeatureController = (Model, options = {}) => {
  const name = options.name || Model.modelName;
  const attachUser = options.attachUser !== false;

  const buildFilter = (req) => {
    if (attachUser && req.user) {
      return { user: req.user._id };
    }
    return {};
  };

  return {
    create: asyncHandler(async (req, res) => {
      const payload = { ...req.body };
      if (attachUser && req.user) {
        payload.user = req.user._id;
      }
      const doc = await Model.create(payload);
      res.status(201).json({ success: true, data: doc });
    }),
    list: asyncHandler(async (req, res) => {
      const docs = await Model.find(buildFilter(req)).sort({ createdAt: -1 });
      res.json({ success: true, data: docs });
    }),
    getById: asyncHandler(async (req, res) => {
      const filter = { _id: req.params.id, ...buildFilter(req) };
      const doc = await Model.findOne(filter);
      if (!doc) {
        return res
          .status(404)
          .json({ success: false, message: `${name} not found` });
      }
      res.json({ success: true, data: doc });
    }),
    update: asyncHandler(async (req, res) => {
      const filter = { _id: req.params.id, ...buildFilter(req) };
      const doc = await Model.findOneAndUpdate(filter, req.body, {
        new: true,
      });
      if (!doc) {
        return res
          .status(404)
          .json({ success: false, message: `${name} not found` });
      }
      res.json({ success: true, data: doc });
    }),
    remove: asyncHandler(async (req, res) => {
      const filter = { _id: req.params.id, ...buildFilter(req) };
      const doc = await Model.findOneAndDelete(filter);
      if (!doc) {
        return res
          .status(404)
          .json({ success: false, message: `${name} not found` });
      }
      res.json({ success: true, data: { id: doc._id } });
    }),
  };
};
