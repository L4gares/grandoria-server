import { Room, Client, CloseCode } from "colyseus";
import { MyRoomState, PlayerState } from "./schema/MyRoomState.js";

type InputMessage = {
  left?: unknown;
  right?: unknown;
  up?: unknown;
  down?: unknown;
};

type PlayerInput = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
};

const PLAYER_SPEED = 90;
const FIXED_TIME_STEP = 1000 / 60;

function createIdleInput(): PlayerInput {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
  };
}

export class MyRoom extends Room {
  maxClients = 50;
  state = new MyRoomState();

  private readonly playerInputs = new Map<string, PlayerInput>();

  messages = {
    input: (client: Client, message: InputMessage) => {
      if (
        !message ||
        typeof message.left !== "boolean" ||
        typeof message.right !== "boolean" ||
        typeof message.up !== "boolean" ||
        typeof message.down !== "boolean"
      ) {
        return;
      }

      if (!this.state.players.has(client.sessionId)) {
        return;
      }

      this.playerInputs.set(client.sessionId, {
        left: message.left,
        right: message.right,
        up: message.up,
        down: message.down,
      });
    },
  };

  onCreate() {
    let elapsedTime = 0;

    this.setSimulationInterval((deltaTime) => {
      elapsedTime += deltaTime;

      while (elapsedTime >= FIXED_TIME_STEP) {
        elapsedTime -= FIXED_TIME_STEP;
        this.fixedTick(FIXED_TIME_STEP);
      }
    });
  }

  private fixedTick(deltaTime: number) {
    const distance = PLAYER_SPEED * (deltaTime / 1000);

    this.state.players.forEach((player, sessionId) => {
      const input = this.playerInputs.get(sessionId);

      if (!input) {
        player.animation = "idle";
        return;
      }

      let moveX = Number(input.right) - Number(input.left);
      let moveY = Number(input.down) - Number(input.up);

      if (moveX === 0 && moveY === 0) {
        player.animation = "idle";
        return;
      }

      if (moveX !== 0 && moveY !== 0) {
        moveX *= Math.SQRT1_2;
        moveY *= Math.SQRT1_2;
      }

      player.x += moveX * distance;
      player.y += moveY * distance;
      player.animation = "walk";

      if (moveY < 0) {
        player.direction = "up";
      } else if (moveY > 0) {
        player.direction = "down";
      } else if (moveX < 0) {
        player.direction = "left";
      } else if (moveX > 0) {
        player.direction = "right";
      }
    });
  }

  onJoin(client: Client) {
    const player = new PlayerState();

    this.state.players.set(client.sessionId, player);
    this.playerInputs.set(client.sessionId, createIdleInput());

    console.log(
      `Jogador ${client.sessionId} entrou. Total: ${this.state.players.size}`
    );
  }

  onLeave(client: Client, code: CloseCode) {
    this.playerInputs.delete(client.sessionId);
    this.state.players.delete(client.sessionId);

    console.log(
      `Jogador ${client.sessionId} saiu. Código: ${code}. Total: ${this.state.players.size}`
    );
  }

  onDispose() {
    console.log(`Sala ${this.roomId} encerrada.`);
  }
}