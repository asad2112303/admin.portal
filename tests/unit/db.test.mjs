import { test } from "node:test";
import assert from "node:assert/strict";
import { databaseConfigFromEnv, missingDatabaseConfig } from "@/lib/db/config";
import { asUtcIso, buildRequestFilter, describeDatabaseError, isDatabaseTimeout, phoneSearchDigits, poolOptions, refusalCode, toSqlUtc } from "@/lib/db/client";

const base = { DATABASE_USER: "eshifa_admin", DATABASE_PASSWORD: "secret-value" };
const page = { page: 1, pageSize: 25 };

test("no filters means no WHERE clause", () => {
  assert.deepEqual(buildRequestFilter(page), { where: "", values: [] });
});

test("status, service and dates become bound parameters", () => {
  const { where, values } = buildRequestFilter({
    ...page,
    status: "contacted",
    service: "Home Nursing Services",
    from: "2026-11-18T19:00:00.000Z",
    to: "2026-11-19T19:00:00.000Z",
  });
  assert.equal(where, "WHERE status = ? AND service = ? AND created_at >= ? AND created_at <= ?");
  assert.equal(values[0], "contacted");
  assert.equal(values[1], "Home Nursing Services");
  // Sent as UTC text, never as a Date the driver would render in local time.
  assert.equal(values[2], "2026-11-18 19:00:00.000");
  assert.equal(values[3], "2026-11-19 19:00:00.000");
});

test("unknown statuses and unreadable dates are ignored, not passed through", () => {
  const { where, values } = buildRequestFilter({ ...page, status: "deleted' OR '1'='1", from: "yesterday-ish", to: "" });
  assert.equal(where, "");
  assert.deepEqual(values, []);
});

test("search covers name, phone digits and the ESH number", () => {
  const { where, values } = buildRequestFilter({ ...page, search: "ESH-100042" });
  assert.equal(where, "WHERE (full_name LIKE ? OR phone_number LIKE ? OR request_no = ?)");
  assert.deepEqual(values, ["%ESH-100042%", "%100042%", 100042]);

  const byPhone = buildRequestFilter({ ...page, search: "0300 1234567" });
  assert.deepEqual(byPhone.values.slice(0, 2), ["%0300 1234567%", "%3001234567%"]);

  const byName = buildRequestFilter({ ...page, search: "Ali Khan" });
  assert.equal(byName.where, "WHERE (full_name LIKE ?)");
  assert.deepEqual(byName.values, ["%Ali Khan%"]);
});

test("search input is data: SQL and LIKE wildcards are neutralised", () => {
  const { where, values } = buildRequestFilter({ ...page, search: "50%_off\\' OR 1=1 --" });
  // The text is never part of the statement, only a parameter.
  assert.ok(!where.includes("OR 1=1") && !where.includes("50"));
  // %, _ and \ match themselves instead of acting as wildcards.
  assert.equal(values[0], "%50\\%\\_off\\\\' OR 1=1 --%");
});

test("very long searches and services are truncated", () => {
  const { values } = buildRequestFilter({ ...page, search: "a".repeat(500), service: "s".repeat(500) });
  assert.equal(values[0].length, 80);
  assert.equal(values[1].length, 102);
});

test("pool reads DATETIME as UTC and never logs bound values", () => {
  const options = poolOptions(databaseConfigFromEnv({ ...base, DATABASE_SOCKET_PATH: "/run/mysqld/mysqld.sock" }), 8000);
  assert.equal(options.timezone, "Z");
  assert.equal(options.dateStrings, true);
  assert.equal(options.logParam, false);
  assert.equal(options.permitLocalInfile, false);
  assert.equal(options.multipleStatements, false);
  assert.equal(options.socketPath, "/run/mysqld/mysqld.sock");
});

test("TCP always uses verified TLS", () => {
  const options = poolOptions(databaseConfigFromEnv({ ...base, DATABASE_HOST: "db.internal" }), 8000);
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.minVersion, "TLSv1.2");
});

test("missing configuration is named", () => {
  assert.deepEqual(missingDatabaseConfig({}), ["DATABASE_SOCKET_PATH", "DATABASE_USER", "DATABASE_PASSWORD"]);
});

test("refusals, timeouts and log lines", () => {
  assert.equal(refusalCode({ sqlState: "45000", sqlMessage: "not_found" }), "not_found");
  assert.equal(refusalCode({ sqlState: "42000", sqlMessage: "not_found" }), null);
  assert.ok(isDatabaseTimeout({ errno: 45028 }));
  assert.equal(isDatabaseTimeout({ errno: 1045 }), false);
  const line = describeDatabaseError(new Error("(conn:3, no: 1644, SQLState: 45000) not_found\nsql: CALL set_callback_status(?, ?, ?) - parameters:['x','new','agent@shifa.com.pk']"));
  assert.match(line, /not_found/);
  assert.ok(!line.includes("agent@") && !line.includes("sql:"));
});

test("stored UTC times come back as ISO 8601 UTC, whatever the machine's time zone", () => {
  assert.equal(asUtcIso("2026-11-19 10:48:09.683215"), "2026-11-19T10:48:09.683Z");
  assert.equal(asUtcIso("2026-11-19 10:48:09"), "2026-11-19T10:48:09.000Z");
  assert.equal(asUtcIso("2026-11-19 10:48:09.5"), "2026-11-19T10:48:09.500Z");
  assert.equal(asUtcIso(null), null);
  assert.equal(Date.parse(asUtcIso("2026-11-19 10:48:09.683")), Date.UTC(2026, 10, 19, 10, 48, 9, 683));
  assert.equal(toSqlUtc(new Date(Date.UTC(2026, 10, 19, 19, 0, 0, 5))), "2026-11-19 19:00:00.005");
});

test("phone search accepts local, international and partial formats", () => {
  assert.equal(phoneSearchDigits("0300 1234567"), "3001234567");
  assert.equal(phoneSearchDigits("+92 300 1234567"), "3001234567");
  assert.equal(phoneSearchDigits("923001234567"), "3001234567");
  assert.equal(phoneSearchDigits("1234567"), "1234567");
  assert.equal(phoneSearchDigits("0"), "0");
  assert.equal(phoneSearchDigits("Ali"), "");
});
