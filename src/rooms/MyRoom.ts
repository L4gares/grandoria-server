import { Room, Client, CloseCode } from "colyseus";
import { MyRoomState, PlayerState } from "./schema/MyRoomState.js";

type MoveMessage = {
  x?: unknown;
  y?: unknown;
  direction?: unknown;
  animation?: unknown;
};

const VALID_DIRECTIONS = new Set<string>([
  "up",
  "down",
  "left",
  "right",
]);

const VALID_ANIMATIONS = new Set<string>([
  "idle",
  "walk",
]);

export class MyRoom extends Room {
  maxClients = 50;
  state = new MyRoomState();

  messages = {
    move: (client: Client, message: MoveMessage) => {
      const player = this.state.players.get(client.sessionId);

      if (!player || !message) {
        return;
      }

      if (
        typeof message.x !== "number" ||
        typeof message.y !== "number" ||
        !Number.isFinite(message.x) ||
        !Number.isFinite(message.y)
      ) {
        return;
      }

      if (
        typeof message.direction !== "string" ||
        !VALID_DIRECTIONS.has(message.direction)
      ) {
        return;
      }

      if (
        typeof message.animation !== "string" ||
        !VALID_ANIMATIONS.has(message.animation)
      ) {
        return;
      }

      player.x = message.x;
      player.y = message.y;
      player.direction = message.direction;
      player.animation = message.animation;
    },
  };

  onJoin(client: Client) {
    const player = new PlayerState();

    this.state.players.set(client.sessionId, player);

    console.log(
      `Jogador ${client.sessionId} entrou. Total: ${this.state.players.size}`
    );
  }

  onLeave(client: Client, code: CloseCode) {
    this.state.players.delete(client.sessionId);

    console.log(
      `Jogador ${client.sessionId} saiu. Código: ${code}. Total: ${this.state.players.size}`
    );
  }

  onDispose() {
    console.log(`Sala ${this.roomId} encerrada.`);
  }
}