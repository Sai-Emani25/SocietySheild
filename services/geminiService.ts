
import { GoogleGenAI, Type } from "@google/genai";
import { AlertType } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const getEvacuationPlan = async (alertType: AlertType, triggererName: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a brief, authoritative emergency instruction for a ${alertType} alert reported by resident ${triggererName}.
      Contexts for Residential Safety:
      - FIRE: Evacuate immediately via stairs. Do not use elevators.
      - DISASTER: Take cover or move to open designated safe zones.
      - CRIME: Shelter in place, lock all entry points, wait for security.
      - INFESTATION: Seal vents and stay in designated clean areas.
      - LOCKDOWN: Complete isolation. Do not open doors for anyone.

      Requirements:
      1. One immediate safety action.
      2. Clear attribution: "Alert detected from ${triggererName}. Security and neighbors notified."
      3. No generic sectors or coordinates.
      4. Maximum 35 words.`,
      config: {
        temperature: 0.7,
        topP: 0.95,
      }
    });

    return response.text;
  } catch (error) {
    console.error("Gemini Advice Error:", error);
    return `EMERGENCY: ${alertType} reported by ${triggererName}. Neighbors have been notified. Please follow safety protocols immediately.`;
  }
};
