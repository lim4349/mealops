import cron from 'node-cron';
import { Attachment } from 'botbuilder';
import type {
  Scheduler,
  VoteService,
  UserRepository,
  BlacklistRepository,
  SelectedHistoryRepository,
  SettingRepository,
  RestaurantRepository,
} from '../core/types.js';
import { buildVoteCard, buildReviewCard } from '../cards/index.js';

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
    private sendNotification: (message: string, card?: Attachment) => Promise<void>
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

    // Check delivery mode - skip if already triggered today
    const triggeredDate = this.settingRepo.getVoteTriggeredDate();
    if (triggeredDate === today) {
      console.log('투표 카드 이미 전송됨 (배달모드), 스킵');
      return;
    }

    // Send vote card
    const restaurants = this.restaurantRepo.findAll();
    const voteResults = this.voteService.getResults(today);
    const soloCount = this.voteService.getSoloCount(today);
    const voteCard = buildVoteCard(restaurants, voteResults, soloCount);

    const message = `🍽️ **점침 투표 시간!**

${this.settingRepo.getForceDecisionEnabled() ? `⏰ ${process.env.VOTE_HOUR}:${process.env.FORCE_DECISION_MINUTE}에 투표 마감됩니다!` : ''}`;

    await this.sendNotification(message, voteCard as any);
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

    // Get the selected restaurant for today
    const selected = this.historyRepo.findByDate(today);
    if (!selected) {
      console.log('오늘 선택된 식당이 없어서 리뷰 알림 스킵');
      return;
    }

    const restaurant = this.restaurantRepo.findById(selected.restaurant_id);
    if (!restaurant) {
      return;
    }

    const reviewCard = buildReviewCard(restaurant.name);
    const message = `⭐ **식사 리뷰 시간!**`;

    await this.sendNotification(message, reviewCard as any);
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
