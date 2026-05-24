import request from "supertest";
import bcrypt from "bcrypt";
import { jest } from "@jest/globals";

// Setup mocks before importing actual modules
jest.unstable_mockModule("../utils/db.js", () => ({
  default: { query: jest.fn() },
}));

jest.unstable_mockModule("../utils/loginAttempts.js", () => ({
  lockoutMsRemaining: jest.fn(),
  recordFailedLogin: jest.fn(),
  resetLoginAttempts: jest.fn(),
}));

// Import modules after mocking
const { default: db } = await import("../utils/db.js");
const { lockoutMsRemaining, recordFailedLogin, resetLoginAttempts } =
  await import("../utils/loginAttempts.js");
const { default: app } = await import("../server.js");

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

afterEach(() => jest.clearAllMocks());

describe("Auth routes", () => {
  test("POST /api/login succeeds with correct credentials", async () => {
    lockoutMsRemaining.mockResolvedValue(0);
    const password = "hunter2";
    const passwordHash = await bcrypt.hash(password, 10);

    db.query.mockImplementation(async (sql) => {
      if (sql.includes("FROM app2.users WHERE email =")) {
        return {
          rows: [
            {
              id: 1,
              first_name: "Test",
              email: "t@example.com",
              username: "tester",
              parent_id: null,
              password_hash: passwordHash,
              email_verified_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith("INSERT INTO app2.tokens")) {
        return { rows: [{ id: 999 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/login")
      .send({ email: "t@example.com", password })
      .expect(200);

    expect(res.body.user).toBeDefined();
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(resetLoginAttempts).toHaveBeenCalled();
  });

  test("POST /api/login fails with wrong password", async () => {
    lockoutMsRemaining.mockResolvedValue(0);
    const password = "correct-password";
    const passwordHash = await bcrypt.hash(password, 10);

    db.query.mockImplementation(async (sql) => {
      if (sql.includes("FROM app2.users WHERE email =")) {
        return {
          rows: [
            {
              id: 2,
              first_name: "Foo",
              email: "foo@example.com",
              username: "foo",
              parent_id: null,
              password_hash: passwordHash,
              email_verified_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/login")
      .send({ email: "foo@example.com", password: "wrong" })
      .expect(400);

    expect(res.body).toHaveProperty("message", "Invalid credentials");
    expect(recordFailedLogin).toHaveBeenCalled();
  });

  test("POST /api/login fails when email is unverified", async () => {
    lockoutMsRemaining.mockResolvedValue(0);
    const password = "hunter2";
    const passwordHash = await bcrypt.hash(password, 10);

    db.query.mockImplementation(async (sql) => {
      if (sql.includes("FROM app2.users WHERE email =")) {
        return {
          rows: [
            {
              id: 3,
              first_name: "Unverified",
              email: "u@example.com",
              username: "unverified",
              parent_id: null,
              password_hash: passwordHash,
              email_verified_at: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/login")
      .send({ email: "u@example.com", password })
      .expect(400);

    expect(res.body).toHaveProperty("message", "Invalid credentials");
    expect(recordFailedLogin).toHaveBeenCalled();
  });
});
