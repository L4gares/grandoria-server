import { Schema, MapSchema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") direction: string = "down";
  @type("string") animation: string = "idle";
}

export class MyRoomState extends Schema {
  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();
}