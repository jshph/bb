import { useEffect, useRef, useState } from "react";
import {
  experimental_useThreadExtensionState,
  useComposer,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { VoiceClient } from "./voice-client.js";
import { voiceStateSchema } from "./voice-state.js";

function VoiceChat({ threadId }: { threadId: string }) {
  const sdk = useSdk();
  const audio = useRef<HTMLAudioElement>(null);
  const client = useRef<VoiceClient | null>(null);
  const [status, setStatus] = useState<"connecting" | "active" | "closed">(
    "closed",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const state = voiceStateSchema.safeParse(
    experimental_useThreadExtensionState(threadId, "voice"),
  );
  const remoteSessionId = state.success ? state.data.sessionId : null;
  const remoteStatus = state.success ? state.data.status : null;
  const remoteMessage = state.success ? state.data.message : null;

  useEffect(() => {
    const stop = () => {
      client.current?.stop();
      client.current = null;
    };
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [threadId]);
  useEffect(() => {
    if (
      remoteSessionId &&
      remoteSessionId === client.current?.sessionId &&
      remoteStatus !== "active"
    )
      client.current.stop(remoteMessage);
  }, [remoteSessionId, remoteStatus, remoteMessage]);

  const start = () => {
    if (!audio.current) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof RTCPeerConnection === "undefined"
    ) {
      setMessage(
        "Voice chat requires microphone access in a supported browser over HTTPS.",
      );
      return;
    }
    setMuted(false);
    setAudioBlocked(false);
    const next = new VoiceClient({
      audio: audio.current,
      mediaDevices: navigator.mediaDevices,
      createPeer: () => new RTCPeerConnection(),
      request: (command) => sdk.threads.voice({ threadId, command }),
      state: (nextStatus, error) => {
        setStatus(nextStatus);
        setMessage(error);
      },
      audioBlocked: () => setAudioBlocked(true),
    });
    client.current = next;
    void next.start();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
      <audio ref={audio} autoPlay />
      {status === "closed" ? (
        <Button type="button" size="sm" variant="ghost" onClick={start}>
          Start voice chat
        </Button>
      ) : (
        <>
          <span role="status" className="text-muted-foreground">
            {status === "connecting"
              ? "Connecting voice…"
              : muted
                ? "Voice chat · microphone muted"
                : "Voice chat · listening"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={status !== "active"}
            aria-pressed={muted}
            onClick={() => {
              const next = !muted;
              client.current?.mute(next);
              setMuted(next);
            }}
          >
            {muted ? "Unmute" : "Mute"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => client.current?.stop()}
          >
            End voice
          </Button>
        </>
      )}
      {audioBlocked && status !== "closed" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void audio.current
              ?.play()
              .then(() => setAudioBlocked(false))
              .catch(() =>
                setMessage(
                  "Allow audio playback in your browser to hear Codex.",
                ),
              );
          }}
        >
          Enable audio
        </Button>
      ) : null}
      {message ? (
        <p role="alert" className="w-full text-destructive-text">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function CodexVoiceBanner() {
  const { scope, selection } = useComposer();
  return scope.kind === "thread" && selection?.providerId === "codex" ? (
    <VoiceChat key={scope.threadId} threadId={scope.threadId} />
  ) : null;
}
