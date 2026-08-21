import { firebaseAdminFirestore } from "../firebase/FirebaseAdmin.js";
import type { QuestProgressData } from "./QuestTypes.js";

export type QuestCharacterIdentity = {
  playerUid: string;
  characterId: string;
};

export function getQuestCharacterDocument(identity: QuestCharacterIdentity) {
  return firebaseAdminFirestore
    .collection("users")
    .doc(identity.playerUid)
    .collection("characters")
    .doc(identity.characterId);
}

export async function persistQuestProgress(
  identity: QuestCharacterIdentity,
  progress: QuestProgressData,
) {
  await getQuestCharacterDocument(identity).update({
    QuestProgress: progress,
  });
}
