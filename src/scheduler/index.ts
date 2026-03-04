import cron from 'node-cron';
import type {
  Scheduler,
  VoteService,
  UserRepository,
  BlacklistRepository,
  SelectedHistoryRepository,
  SettingRepository,
  RestaurantRepository,
} from '../core/types.js';

// Define ScheduledTask type locally
interface ScheduledTask {
  stop(): void;
  start(): void;
}

export class SchedulerImpl implements Scheduler {
  private voteTask: ReturnType<typeof cron.schedule> | null = null;
  private decisionTask: ReturnType<typeof cron.schedule> | null = null;
  private reviewTask: ReturnType<typeof cron.schedule> | null = null;

  constructor(
    private voteService: VoteService,
    private userRepo: UserRepository,
    private blacklistRepo: BlacklistRepository,
    private historyRepo: SelectedHistoryRepository,
    private settingRepo: SettingRepository,
    private restaurantRepo: RestaurantRepository,
    private sendNotification: (message: string) => Promise<void>
  ) {}

  start(): void {
    const voteHour = process.env.VOTE_HOUR ?? '11';
    const reviewHour = process.env.REVIEW_HOUR ?? '12';
    const reviewMinute = process.env.REVIEW_MINUTE ?? '50';
    const forceMinute = parseInt(process.env.FORCE_DECISION_MINUTE ?? '30', 10);

    // Vote reminder at VOTE_HOUR:00
    this.voteTask = cron.schedule(`0 ${voteHour} * * 1-5`, async () => {
      if (this.isHoliday(new Date())) {
        console.log('Today is holiday, skipping vote reminder');
        return;
      }
      await this.sendVoteReminder();
    }, {
      timezone: process.env.TIMEZONE ?? 'Asia/Seoul',
    });

    // Force decision at VOTE_HOUR:FORCE_MINUTE
    this.decisionTask = cron.schedule(`${forceMinute} ${voteHour} * * 1-5`, async () => {
      if (this.isHoliday(new Date())) {
        console.log('Today is holiday, skipping force decision');
        return;
      }
      if (!this.settingRepo.getForceDecisionEnabled()) {
        console.log('Force decision is disabled');
        return;
      }
      await this.makeForceDecision();
    }, {
      timezone: process.env.TIMEZONE ?? 'Asia/Seoul',
    });

    // Review reminder at REVIEW_HOUR:REVIEW_MINUTE
    this.reviewTask = cron.schedule(`${reviewMinute} ${reviewHour} * * 1-5`, async () => {
      if (this.isHoliday(new Date())) {
        console.log('Today is holiday, skipping review reminder');
        return;
      }
      await this.sendReviewReminder();
    }, {
      timezone: process.env.TIMEZONE ?? 'Asia/Seoul',
    });

    console.log('Scheduler started');
  }

  stop(): void {
    this.voteTask?.stop();
    this.decisionTask?.stop();
    this.reviewTask?.stop();
    console.log('Scheduler stopped');
  }

  isHoliday(date: Date): boolean {
    // Check weekends
    const day = date.getDay();
    if (day === 0 || day === 6) return false; // Weekends are OK for lunch

    // Check custom holidays from DB would go here
    // For now, just return false
    return false;
  }

  private async sendVoteReminder(): Promise<void> {
    const today = this.formatDate(new Date());
    const message = `🍽️ **점심 투표 시간!**

오늘( ${today} ) 점심 메뉴를 투표해주세요!

\`/추천\` - AI 추천 받기
\`/목록\` - 식당 목록 보기
\`/투표 [식당이름]\` - 투표하기

${this.settingRepo.getForceDecisionEnabled() ? `⏰ ${process.env.VOTE_HOUR}:${process.env.FORCE_DECISION_MINUTE}에 투표 마감됩니다!` : ''}`;

    await this.sendNotification(message);
  }

  private async makeForceDecision(): Promise<void> {
    const today = this.formatDate(new Date());
    const result = this.voteService.decideWinner(today);

    if (result.success && result.data) {
      await this.sendNotification(`⏰ **투표 마감!**

${result.message}

이유: ${result.data.reason}`);

      // Save to history
      const restaurant = this.restaurantRepo.findByName(result.data.restaurant);
      if (restaurant) {
        const voteResults = this.voteService.getResults(today);
        const totalVotes = voteResults.reduce((sum, r) => sum + r.count, 0);
        this.historyRepo.add(restaurant.id, today, totalVotes);
      }
    }
  }

  private async sendReviewReminder(): Promise<void> {
    const today = this.formatDate(new Date());
    const message = `⭐ **식사 리뷰 시간!**

오늘 점심 맛은 어땠나요?

\`/리뷰 [식당이름] [1-5점] [코멘트]\`

예시: \`/리뷰 본죽 5 따뜻해서 좋았어요\``;

    await this.sendNotification(message);
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
