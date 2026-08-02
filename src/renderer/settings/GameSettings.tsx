import type {
  GameId,
  GameRecord,
  PetOperationResult,
} from '../../shared/contracts';

interface GameSettingsProps {
  records: GameRecord[];
  busy: boolean;
  onOperation: (
    operation: () => Promise<PetOperationResult>,
  ) => void;
}

const GAME_CARDS: ReadonlyArray<{
  gameId: GameId;
  title: string;
  description: string;
}> = [
  {
    gameId: 'catch_food',
    title: '接食物大作战',
    description: '移动土豆接住食物，连击、道具、炸弹和限时狂热。',
  },
  {
    gameId: 'dodge_mouse',
    title: '躲避鼠标挑战',
    description: '用鼠标逼近并点击土豆，观察它冲刺、逃跑和短暂挑衅。',
  },
];

export function GameSettings({
  records,
  busy,
  onOperation,
}: GameSettingsProps) {
  return (
    <section className="settings-card game-settings-card">
      <div className="section-heading">
        <div>
          <h2>小游戏</h2>
          <p>固定时间步长运行，结果、最高分和每日奖励保存在本地。</p>
        </div>
      </div>
      <div className="game-card-list">
        {GAME_CARDS.map((game) => {
          const record = records.find(
            (item) => item.gameId === game.gameId,
          );
          return (
            <article className="game-card" key={game.gameId}>
              <div>
                <h3>{game.title}</h3>
                <p>{game.description}</p>
                <dl>
                  <div>
                    <dt>最高分</dt>
                    <dd>{record?.highScore ?? 0}</dd>
                  </div>
                  <div>
                    <dt>次数</dt>
                    <dd>{record?.playCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>评级</dt>
                    <dd>{record?.bestGrade ?? 'D'}</dd>
                  </div>
                </dl>
              </div>
              <button
                className="secondary compact-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  onOperation(() =>
                    window.desktopPet.openGame(game.gameId),
                  )
                }
              >
                开始游戏
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
