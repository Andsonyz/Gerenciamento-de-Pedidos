import { it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { request } from "node:https";
import { createApplication } from "../src/app.js";

// Ephemeral test CA: no external service, persisted private key or OS trust-store changes.
function testCertificate() {
  const der = (tag: number, ...parts: Buffer[]) => {
    const content = Buffer.concat(parts);
    let length: Buffer;
    if (content.length < 128) length = Buffer.from([content.length]);
    else {
      let hex = content.length.toString(16);
      if (hex.length % 2) hex = "0" + hex;
      const bytes = Buffer.from(hex, "hex");
      length = Buffer.concat([Buffer.from([128 + bytes.length]), bytes]);
    }
    return Buffer.concat([Buffer.from([tag]), length, content]);
  };
  const seq = (...parts: Buffer[]) => der(0x30, ...parts),
    integer = (n: number) => der(2, Buffer.from([n]));
  const algorithm = seq(Buffer.from("06092a864886f70d01010b0500", "hex"));
  const name = seq(
    der(0x31, seq(Buffer.from("0603550403", "hex"), der(0x0c, Buffer.from("localhost")))),
  );
  const date = (offset: number) => {
    const d = new Date(Date.now() + offset);
    return der(
      0x17,
      Buffer.from(
        d.toISOString().replace(/[-:]/g, "").slice(2, 15).replace("T", "") + "Z",
      ),
    );
  };
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const extensions = der(
    0xa3,
    seq(
      seq(
        Buffer.from("0603551d11", "hex"),
        der(
          4,
          seq(
            der(0x82, Buffer.from("localhost")),
            der(0x87, Buffer.from([127, 0, 0, 1])),
          ),
        ),
      ),
      seq(
        Buffer.from("0603551d13", "hex"),
        der(1, Buffer.from([255])),
        der(4, seq(der(1, Buffer.from([255])))),
      ),
    ),
  );
  const body = seq(
    der(0xa0, integer(2)),
    integer(1),
    algorithm,
    name,
    seq(date(-86400000), date(86400000)),
    name,
    keys.publicKey.export({ format: "der", type: "spki" }),
    extensions,
  );
  const certificate = seq(
    body,
    algorithm,
    der(3, Buffer.from([0]), sign("sha256", body, keys.privateKey)),
  );
  return {
    key: Buffer.from(keys.privateKey.export({ format: "pem", type: "pkcs8" })),
    cert: Buffer.from(
      "-----BEGIN CERTIFICATE-----\n" +
        certificate
          .toString("base64")
          .match(/.{1,64}/g)!
          .join("\n") +
        "\n-----END CERTIFICATE-----\n",
    ),
  };
}

it("HTTPS autentica com certificado validado e emite cookie Secure/HttpOnly", async () => {
  const tls = testCertificate();
  const server = createApplication({
    dbPath: ":memory:",
    tls,
    bootstrapAdmin: {
      username: "admin",
      name: "Admin",
      password: "TLS-test-password-123!",
    },
  });
  try {
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    const address = server.http.address();
    if (!address || typeof address === "string") throw new Error("Porta ausente");
    const result = await new Promise<{
      status: number;
      cookie: string[];
      body: { csrfToken: string };
    }>((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/api/auth/login",
          method: "POST",
          ca: tls.cert,
          rejectUnauthorized: true,
          headers: { "Content-Type": "application/json" },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () =>
            resolve({
              status: response.statusCode!,
              cookie: response.headers["set-cookie"] ?? [],
              body: JSON.parse(Buffer.concat(chunks).toString()) as { csrfToken: string },
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ username: "admin", password: "TLS-test-password-123!" }));
    });
    expect(result.status).toBe(200);
    expect(result.cookie[0]).toContain("Secure");
    expect(result.cookie[0]).toContain("HttpOnly");
    expect(result.cookie[0]).toContain("SameSite=Strict");
    expect(result.body.csrfToken).toHaveLength(64);
  } finally {
    await server.close();
  }
});
