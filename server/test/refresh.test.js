import request from "supertest";
import jwt from "jsonwebtoken";
import { jest } from "@jest/globals";

jest.unstable_mockModule("../utils/db.js", () => ({
  default: { query: jest.fn() },
}));

jest.unstable_mockModule("../utils/refreshRotations.js", () => ({
  wasRecentlyRotated: jest.fn(),
  recordRotation: jest.fn(),
}));

const { default: db } = await import("../utils/db.js");
const { wasRecentlyRotated, recordRotation } =
  await import("../utils/refreshRotations.js");
const { default: app } = await import("../server.js");

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

afterEach(() => jest.clearAllMocks());

describe("Refresh token rotation", () => {
  test("Successful rotation: consumed token -> new access token and set-cookie", async () => {
    const payload = { sub: 10, jti: 777, type: "refresh" };
    const token = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
      expiresIn: "7d",
    });

    db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("DELETE FROM app2.tokens")) {
        return { rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO app2.tokens")) {
        return { rows: [{ id: 888 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/refresh")
      .set("Cookie", `refreshToken=${token}`)
      .expect(200);

    expect(res.body).toHaveProperty("accessToken");
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(recordRotation).toHaveBeenCalled();
  });

  test("Race win lost: consumed 0 but wasRecentlyRotated true -> return access token", async () => {
    const payload = { sub: 11, jti: 555, type: "refresh" };
    const token = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
      expiresIn: "7d",
    });

    wasRecentlyRotated.mockResolvedValue(true);

    db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("DELETE FROM app2.tokens")) {
        return { rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/refresh")
      .set("Cookie", `refreshToken=${token}`)
      .expect(200);

    expect(res.body).toHaveProperty("accessToken");
    expect(recordRotation).not.toHaveBeenCalled();
  });

  test("Token reuse detection: consumed 0 and not recently rotated -> 403", async () => {
    const payload = { sub: 12, jti: 444, type: "refresh" };
    const token = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
      expiresIn: "7d",
    });

    wasRecentlyRotated.mockResolvedValue(false);

    db.query.mockImplementation(async (sql) => {
      if (sql.startsWith("DELETE FROM app2.tokens")) {
        return { rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post("/api/refresh")
      .set("Cookie", `refreshToken=${token}`)
      .expect(403);

    expect(res.body).toHaveProperty("message", "Token reuse detected");
  });
});
