import { Room, Client, CloseCode } from "colyseus";
import { MyRoomState, PlayerState } from "./schema/MyRoomState.js";

export class MyRoom extends Room {
  maxClients = 50;
  state = new MyRoomState();

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