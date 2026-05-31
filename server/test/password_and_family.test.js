import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { jest } from "@jest/globals";

// Mock db before importing app
jest.unstable_mockModule("../utils/db.js", () => ({
  default: { query: jest.fn() },
}));

const { default: db } = await import("../utils/db.js");
const { default: app } = await import("../server.js");

beforeAll(() => {
  process.env.JWT_RESET_SECRET =
    process.env.JWT_RESET_SECRET || "test-reset-secret";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
});

afterEach(() => jest.clearAllMocks());

describe("Password reset flow", () => {
  test("POST /api/forgot-password returns resetUrl when SMTP not configured", async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("SELECT id FROM app2.users WHERE email")) {
        return { rows: [{ id: 501 }], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO app2.tokens (user_id, type")) {
        return { rows: [{ id: 600 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    delete process.env.RESEND_API_KEY;

    const res = await request(app)
      .post("/api/forgot-password")
      .send({ email: "child@example.com" })
      .expect(200);

    expect(res.body).toHaveProperty("resetUrl");
  });

  test("POST /api/reset-password succeeds with valid token", async () => {
    const userId = 502;
    // Insert token id 700
    const token = jwt.sign(
      { sub: userId, jti: 700, type: "reset_password" },
      process.env.JWT_RESET_SECRET,
      { expiresIn: "15m" },
    );

    const oldPasswordHash = await bcrypt.hash("oldpass", 10);

    db.query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT expires_at, used FROM app2.tokens")) {
        return { rows: [{ used: false }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT password_hash FROM app2.users")) {
        return { rows: [{ password_hash: oldPasswordHash }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE app2.users SET password_hash")) {
        return { rowCount: 1 };
      }
      if (sql.startsWith("UPDATE app2.tokens SET used")) {
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/reset-password")
      .send({
        token,
        newPassword: "newpassword123",
        confirmNewPassword: "newpassword123",
      })
      .expect(200);

    expect(res.body).toHaveProperty("message", "Password reset successfully");
  });

  test("POST /api/reset-password with invalid token returns 404", async () => {
    const userId = 503;
    const token = jwt.sign(
      { sub: userId, jti: 701, type: "reset_password" },
      process.env.JWT_RESET_SECRET,
      { expiresIn: "15m" },
    );

    db.query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT expires_at, used FROM app2.tokens")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/reset-password")
      .send({
        token,
        newPassword: "x12345678",
        confirmNewPassword: "x12345678",
      })
      .expect(404);

    expect(res.body).toHaveProperty("message", "Token not found or expired");
  });
});

describe("Family kid-requests", () => {
  test("POST /api/kid-requests returns 403 if not a child account", async () => {
    const childId = 9001;
    // create access token
    const access = jwt.sign(
      { sub: childId, type: "access" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("SELECT parent_id, first_name FROM app2.users")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/family/kid-requests")
      .set("Authorization", `Bearer ${access}`)
      .send({ listId: 1, itemName: "Choco", quantity: 1 })
      .expect(403);

    expect(res.body).toHaveProperty("message", "Not a child account");
  });

  test("POST /api/kid-requests returns 403 if child not member of list", async () => {
    const childId = 9002;
    const access = jwt.sign(
      { sub: childId, type: "access" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("SELECT parent_id, first_name FROM app2.users")) {
        return { rows: [{ parent_id: 200, first_name: "Kiddo" }], rowCount: 1 };
      }
      if (sql.includes("SELECT 1 FROM app.list_members")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/family/kid-requests")
      .set("Authorization", `Bearer ${access}`)
      .send({ listId: 123, itemName: "Choco", quantity: 1 })
      .expect(403);

    expect(res.body).toHaveProperty("message", "Not a member of this list");
  });

  test("POST /api/kid-requests succeeds and emits to parent", async () => {
    const childId = 9003;
    const parentId = 300;
    const access = jwt.sign(
      { sub: childId, type: "access" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    const mockEmit = jest.fn();
    app.locals.io = { to: () => ({ emit: mockEmit }) };

    db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("SELECT parent_id, first_name FROM app2.users")) {
        return {
          rows: [{ parent_id: parentId, first_name: "Kiddo" }],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT 1 FROM app.list_members")) {
        return { rows: [{ 1: 1 }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT list_name FROM app.list")) {
        return { rows: [{ list_name: "MyList" }], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO app2.kid_requests")) {
        return { rows: [{ id: 7001 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/family/kid-requests")
      .set("Authorization", `Bearer ${access}`)
      .send({ listId: 55, itemName: "Milk", quantity: 2 })
      .expect(201);

    expect(res.body).toHaveProperty("message", "Request sent");
    expect(mockEmit).toHaveBeenCalled();
  });
});
