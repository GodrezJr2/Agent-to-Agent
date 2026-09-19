// Spike: pin down how @a2a-js/sdk v1 wires a server agent and a client over
// real HTTP. Kept as a regression test so SDK upgrades that change shapes fail
// loudly here instead of deep inside the office executor.
import { describe, it, expect, afterAll } from "vitest";
import express from "express";
import { AGENT_CARD_PATH, A2A_PROTOCOL_VERSION, Role, TaskState } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore, AgentEvent } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import { ClientFactory } from "@a2a-js/sdk/client";

const text = (value) => ({ content: { $case: "text", value }, metadata: undefined, filename: "", mediaType: "text/plain" });

class EchoExecutor {
  async cancelTask() {}
  async execute(ctx, bus) {
    const { taskId, contextId, userMessage } = ctx;
    bus.publish(AgentEvent.task({ id: taskId, contextId, status: { state: TaskState.TASK_STATE_SUBMITTED, timestamp: new Date().toISOString(), message: undefined }, artifacts: [], history: [userMessage], metadata: {} }));
    const input = userMessage.parts.map((p) => p.content?.value).join("");
    bus.publish(AgentEvent.artifactUpdate({ taskId, contextId, artifact: { artifactId: "a1", name: "reply", description: "", parts: [text(`echo:${input}`)], metadata: undefined, extensions: [] }, append: false, lastChunk: true, metadata: undefined }));
    bus.publish(AgentEvent.statusUpdate({ taskId, contextId, status: { state: TaskState.TASK_STATE_COMPLETED, timestamp: new Date().toISOString(), message: undefined }, metadata: undefined }));
  }
}

let server;
afterAll(() => server && new Promise((r) => server.close(r)));

describe("@a2a-js/sdk v1 wiring", () => {
  it("serves an agent card and completes a task over JSON-RPC", async () => {
    const app = express();
    server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/agents/echo`;
    const card = {
      name: "Echo", description: "echo", version: "1.0.0",
      supportedInterfaces: [{ url: base, protocolBinding: "JSONRPC", tenant: "", protocolVersion: A2A_PROTOCOL_VERSION }],
      capabilities: { streaming: true, pushNotifications: false, extensions: [], extendedAgentCard: false },
      securitySchemes: {}, securityRequirements: [], defaultInputModes: ["text"], defaultOutputModes: ["text"],
      skills: [], signatures: [], documentationUrl: "", provider: undefined,
    };
    const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), new EchoExecutor());
    const router = express.Router();
    router.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: handler }));
    router.use(jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
    app.use("/agents/echo", router);

    const cardRes = await fetch(`${base}/${AGENT_CARD_PATH}`);
    expect(cardRes.status).toBe(200);

    const client = await new ClientFactory().createFromUrl(`${base}/`);
    const result = await client.sendMessage({
      message: { messageId: "m1", contextId: "", taskId: "", role: Role.ROLE_USER, parts: [text("hi")], metadata: {}, extensions: [], referenceTaskIds: [] },
      configuration: undefined, metadata: {}, tenant: "",
    });
    const task = result.task ?? result;
    expect(task.status.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(task.artifacts[0].parts[0].content.value).toBe("echo:hi");
  });
});
