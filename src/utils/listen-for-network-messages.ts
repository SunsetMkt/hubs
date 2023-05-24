import { addComponent, hasComponent, removeComponent } from "bitecs";
import {
  connectedClientIds,
  disconnectedClientIds,
  localClientID,
  pendingCreatorChanges,
  pendingJoins,
  pendingMessages,
  pendingParts
} from "../bit-systems/networking";
import { EntityState } from "./entity-state-utils";
import type { ClientID, CreatorChange, Message } from "./networking-types";
import { FileInfo, Pinnable, Pinned } from "../bit-components";
import { FILE_INFO_FLAGS } from "../inflators/file-info";

type Emitter = {
  on: (event: string, callback: (a: any) => any) => number;
  off: (event: string, ref: number) => void;
  trigger: (event: string, payload: any) => void;
  getBindings: () => any[];
};
type PhoenixChannel = any;

export function listenForNetworkMessages(channel: PhoenixChannel, presenceEventEmitter: Emitter) {
  presenceEventEmitter.on("hub:join", onJoin);
  presenceEventEmitter.on("hub:leave", onLeave);
  channel.on("naf", onNaf);
  channel.on("nafr", onNafr);
  channel.on("entity_state_saved", onEntityStateCreated);
  channel.on("entity_state_updated", onEntityStateUpdated);
  channel.on("entity_state_deleted", onEntityStateDeleted);
}

function onJoin({ key }: { key: ClientID }) {
  const clientId = APP.getSid(key);
  if (clientId !== localClientID!) {
    pendingJoins.push(clientId);
    connectedClientIds.add(clientId);
    disconnectedClientIds.delete(clientId); // In case of reconnect
  }
}

function onLeave({ key }: { key: ClientID }) {
  const clientId = APP.getSid(key);
  if (clientId !== localClientID!) {
    pendingParts.push(clientId);
    connectedClientIds.delete(clientId);
    disconnectedClientIds.add(clientId);
  }
}

type NafMessage = {
  from_session_id: string;
  data: any;
  dataType: string;
  source: string;
};
function onNaf({ from_session_id, data, dataType }: NafMessage) {
  if (dataType == "nn") {
    (data as Message).fromClientId = from_session_id;
    pendingMessages.push(data);
  }
}

type NafrMessage = {
  from_session_id: string;
  naf: string;
  parsed?: NafMessage;
};
function onNafr(message: NafrMessage) {
  const { from_session_id, naf: unparsedData } = message;
  // Attach the parsed JSON to the message so that
  // PhoenixAdapter can process it without parsing it again.
  message.parsed = JSON.parse(unparsedData);
  message.parsed!.from_session_id = from_session_id;
  onNaf(message.parsed!);
}

export function queueEntityStateAsMessage(entityState: EntityState) {
  const rootNid = entityState.create_message.networkId;
  entityState.update_messages.forEach(update => {
    update.owner = "reticulum";
  });
  pendingMessages.push({
    fromClientId: "reticulum",
    creates: [entityState.create_message],
    updates: entityState.update_messages,
    deletes: []
  });
  pendingCreatorChanges.push({
    nid: rootNid,
    creator: "reticulum"
  });
}

function onEntityStateCreated(response: { data: EntityState[] }) {
  const rootNid = APP.getSid(response.data[0]!.create_message.networkId);
  const eid = APP.world.nid2eid.get(rootNid);
  if (eid) {
    if (hasComponent(APP.world, Pinnable, eid)) {
      addComponent(APP.world, Pinned, eid);
    }
    if (hasComponent(APP.world, FileInfo, eid)) {
      FileInfo.flags[eid] |= FILE_INFO_FLAGS.IS_PERMANENT;
    }
  }
  queueEntityStateAsMessage(response.data[0]!);
}

function onEntityStateUpdated(_response: any) {
  // console.log("entity_state_updated", response);
}

function onEntityStateDeleted(response: CreatorChange) {
  const rootNid = APP.getSid(response.nid);
  const eid = APP.world.nid2eid.get(rootNid);
  if (eid) {
    removeComponent(APP.world, Pinned, eid);
  }
  pendingCreatorChanges.push(response);
}
