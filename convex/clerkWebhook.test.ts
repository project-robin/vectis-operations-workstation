import { Webhook } from "standardwebhooks";
import { expect, test } from "vitest";
import { verifyClerkRequest } from "./http/clerkWebhook";

const secret = `whsec_${Buffer.from("task3-synthetic-webhook-secret").toString("base64")}`;
const payload = JSON.stringify({ type: "user.created", data: { id: "user_webhook" } });

function signedRequest(body = payload) {
  const id = "msg_task3_1";
  const timestamp = new Date();
  const webhook = new Webhook(secret);
  return new Request("https://synthetic.invalid/clerk/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": webhook.sign(id, timestamp, body),
    },
    body,
  });
}

test("Clerk SDK verification rejects missing and invalid signatures", async () => {
  await expect(verifyClerkRequest(new Request("https://synthetic.invalid", { method: "POST", body: payload }), secret)).rejects.toThrow();
  const request = signedRequest();
  request.headers.set("svix-signature", "v1.invalid");
  await expect(verifyClerkRequest(request, secret)).rejects.toThrow();
});

test("Clerk SDK verification accepts a synthetic Standard Webhooks signature", async () => {
  await expect(verifyClerkRequest(signedRequest(), secret)).resolves.toMatchObject({
    type: "user.created",
    data: { id: "user_webhook" },
  });
});
