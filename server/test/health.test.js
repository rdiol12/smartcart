import request from "supertest";
import app from "../server.js";

describe("Health endpoint", () => {
  test("GET /health should return 200", async () => {
    const res = await request(app).get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
  }, 10000);
});
