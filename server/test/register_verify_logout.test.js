import request from "supertest";
import jwt from "jsonwebtoken";
import { jest } from "@jest/globals";

jest.unstable_mockModule("../utils/db.js", () => ({
  default: { query: jest.fn() },
}));

const { default: db } = await import("../utils/db.js");
const { default: app } = await import("../server.js");

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_EMAIL_SECRET = "test-email-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

afterEach(() => jest.clearAllMocks());

describe("Register, verify-email, logout", () => {
  test("POST /api/register returns 201 for new user", async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("INSERT INTO app2.users")) {
        return { rowCount: 1, rows: [{ id: 42 }] };
      }
      if (sql.startsWith("INSERT INTO app2.tokens")) {
        return { rowCount: 1, rows: [{ id: 123 }] };
      }
      return { rowCount: 0, rows: [] };
    });

    const res = await request(app)
      .post("/api/register")
      .send({
        first_name: "A",
        last_name: "B",
        email: "a@b.com",
        password: "password123",
        confirmPassword: "password123",
      })
      .expect(201);

    expect(res.body).toHaveProperty("message");
  });

  test("POST /api/register with existing verified email returns 201", async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("INSERT INTO app2.users")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("WHERE email = $1 AND email_verified_at IS NULL")) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const res = await request(app)
      .post("/api/register")
      .send({
        first_name: "A",
        last_name: "B",
        email: "existing@x.com",
        password: "password123",
        confirmPassword: "password123",
      })
      .expect(201);

    expect(res.body).toHaveProperty("message");
  });

  test("GET /api/verify-email redirects and sets cookie", async () => {
    const payload = { sub: 77, type: "email_verify", jti: 555 };
    const token = jwt.sign(payload, process.env.JWT_EMAIL_SECRET, {
      expiresIn: "1h",
    });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT used FROM app2.tokens WHERE id =")) {
        return { rowCount: 1, rows: [{ used: false }] };
      }
      if (sql.startsWith("UPDATE app2.users")) {
        return {
          rowCount: 1,
          rows: [{ id: payload.sub, first_name: "X", email: "x@x" }],
        };
      }
      if (sql.startsWith("UPDATE app2.tokens SET used")) {
        return { rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO app2.tokens")) {
        return { rows: [{ id: 999 }], rowCount: 1 };
      }
      return { rowCount: 0, rows: [] };
    });

    const res = await request(app)
      .get("/api/verify-email")
      .query({ token })
      .expect(302);

    expect(res.headers.location).toMatch(/verification-confirmed/);
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  test("POST /api/logout clears cookie", async () => {
    const payload = { sub: 5, jti: 9999, type: "refresh" };
    const token = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
      expiresIn: "1d",
    });

    db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("DELETE FROM app2.tokens WHERE id =")) {
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/logout")
      .set("Cookie", `refreshToken=${token}`)
      .expect(200);

    expect(res.body).toHaveProperty("message", "Logged out");
  });
});
