import { body, param, query, validationResult } from "express-validator";

// Validation error handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }
  next();
};

// Auth validators
const registerValidator = [
  body("email").isEmail(),
  body("password").isLength({ min: 8 }),
  body("confirmPassword").notEmpty(),
  body("first_name").trim().isLength({ min: 1, max: 100 }),
  body("last_name").trim().isLength({ min: 1, max: 100 }),
  validate,
];

const loginValidator = [
  body("email").optional().isEmail(),
  body("username").optional().trim().notEmpty(),
  body("password").notEmpty(),
  validate,
];

// Product validators
const searchProductValidator = [
  query("q").trim().isLength({ min: 1, max: 200 }),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  query("offset").optional().isInt({ min: 0 }).toInt(),
  validate,
];

const barcodeValidator = [
  param("barcode").isLength({ min: 8, max: 13 }).isNumeric(),
  validate,
];

// Family validators. Field names match what the frontend actually sends
// (camelCase from React). Previously this validated `item_name` while the
// handler destructured `itemName`, so even if it had been wired in it
// would have rejected every legitimate request.
const kidRequestValidator = [
  body("listId").isInt({ min: 1 }).toInt(),
  body("itemName").trim().isLength({ min: 1, max: 200 }),
  body("price").optional({ nullable: true }).isFloat({ min: 0 }),
  body("storeName")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 100 }),
  body("quantity")
    .optional({ nullable: true })
    .isInt({ min: 1, max: 999 })
    .toInt(),
  body("productId").optional({ nullable: true }).isInt({ min: 1 }).toInt(),
  validate,
];

// Note: createListValidator was previously exported here but never wired up.
// REST has no POST /lists endpoint — list creation runs over the socket
// `create_list` event, which is validated by Zod in utils/socketSchemas.js.
// Re-add an HTTP validator here only when/if a REST list-create endpoint
// gets introduced.

export {
  validate,
  registerValidator,
  loginValidator,
  searchProductValidator,
  barcodeValidator,
  kidRequestValidator,
};
