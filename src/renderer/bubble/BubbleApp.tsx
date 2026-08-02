import { useEffect, useState } from 'react';

interface SpeechShowPayload {
  text: string;
  emotion: string;
  nightMode: boolean;
}

/**
 * 气泡渲染，视觉参数对齐 desktop_pet ui/speech_bubble.py：
 * 情绪配色（angry/happy/sleepy/normal）、圆角 13px、尾巴、夜间模式。
 */
export function BubbleApp() {
  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState<SpeechShowPayload | null>(null);

  useEffect(() => {
    window.desktopPet.sendSpeechReady();
    const offShow = window.desktopPet.onSpeechShow((next) => {
      setPayload(next);
      setVisible(true);
    });
    const offHide = window.desktopPet.onSpeechHide(() => {
      setVisible(false);
    });
    return () => {
      offShow();
      offHide();
    };
  }, []);

  if (!payload) {
    return <main className="bubble-stage" data-visible="false" />;
  }
  return (
    <main className="bubble-stage" data-visible={visible ? 'true' : 'false'}>
      <div
        className="bubble-card"
        data-emotion={payload.emotion}
        data-night={payload.nightMode ? 'true' : 'false'}
      >
        <p>{payload.text}</p>
        <span className="bubble-tail" aria-hidden="true" />
      </div>
    </main>
  );
}
