import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientEvents, Order, ServerEvents } from "@restaurante/shared";
import { mergeOrder, normalizeOrders } from "./order-state";

export function usePrinter() {
  const socket = useRef<Socket<ServerEvents, ClientEvents> | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hasSynced, setHasSynced] = useState(false);
  useEffect(() => {
    const client: Socket<ServerEvents, ClientEvents> = io({
      autoConnect: false,
    });
    socket.current = client;
    client.on("orders:snapshot", (snapshot) => {
      setOrders(normalizeOrders(snapshot));
      setConnected(true);
      setHasSynced(true);
    });
    client.on("order:upsert", (order) =>
      setOrders((current) => mergeOrder(current, order)),
    );
    client.on("disconnect", () => setConnected(false));
    client.on("connect_error", () => setConnected(false));
    client.connect();
    return () => {
      client.removeAllListeners();
      client.disconnect();
      socket.current = null;
    };
  }, []);
  function toggleConnection() {
    if (paused) {
      setPaused(false);
      socket.current?.connect();
    } else {
      setPaused(true);
      setConnected(false);
      socket.current?.disconnect();
    }
  }
  return { orders, connected, paused, hasSynced, toggleConnection };
}
