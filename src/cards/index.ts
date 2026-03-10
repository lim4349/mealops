import { CardFactory } from 'botbuilder';
import type { Attachment } from 'botbuilder';
import type { Restaurant, RecommendationResult, VoteResult, SelectedHistory, RestaurantRepository, VoterEntry, WeatherInfo } from '../core/types.js';

// Top menu ActionSet - 모든 카드 상단에 공통으로 추가
function buildTopMenuActionSet(): any {
  return {
    type: 'ActionSet',
    actions: [
      {
        type: 'Action.Execute',
        verb: 'main_menu',
        title: '🏠 메뉴로',
        data: {},
      },
    ],
  };
}

// Main menu card - 날씨 표시 + 버튼 8개 (ActionSet 4+4)
export function buildMainMenuCard(weather?: WeatherInfo): Attachment {
  const body: any[] = [
    {
      type: 'TextBlock',
      text: '🍽️ MeaLOps',
      weight: 'bolder',
      size: 'large',
    },
  ];

  if (weather) {
    const weatherEmoji =
      weather.condition === 'rain'   ? '🌧️' :
      weather.condition === 'snow'   ? '❄️' :
      weather.condition === 'clouds' ? '☁️' : '☀️';
    body.push({
      type: 'TextBlock',
      text: `${weatherEmoji} ${weather.temp}°C, ${weather.description}`,
      wrap: true,
      spacing: 'small',
      isSubtle: true,
      size: 'small',
    });
  }

  // ActionSet 1: 4개 버튼
  body.push({
    type: 'ActionSet',
    actions: [
      { type: 'Action.Execute', verb: 'show_vote',    title: '🗳️ 투표하기',   data: {} },
      { type: 'Action.Execute', verb: 'recommend',    title: '🤖 AI 추천',    data: {} },
      { type: 'Action.Execute', verb: 'show_list',    title: '📋 식당목록',   data: {} },
      { type: 'Action.Execute', verb: 'my_favorites', title: '⭐ 내최애',     data: {} },
    ],
  });

  // ActionSet 2: 3개 버튼 (식당추가 제거)
  body.push({
    type: 'ActionSet',
    actions: [
      { type: 'Action.Execute', verb: 'my_blacklist',   title: '🚫 블랙리스트', data: {} },
      { type: 'Action.Execute', verb: 'show_settings',  title: '⚙️ 설정',      data: {} },
      { type: 'Action.Execute', verb: 'dashboard',      title: '📊 히스토리',  data: {} },
    ],
  });

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}

// 투표 카드 한 행 헬퍼 (득표수 뱃지 + 이름/정보 + 명시적 버튼)
function buildVoteRow(
  verb: string,
  data: any,
  nameText: string,
  subItems: any[],
  count: number,
  isSelected: boolean,
  textColor: string
): any {
  return {
    type: 'ColumnSet',
    spacing: 'small',
    columns: [
      // 좌: 득표수 뱃지
      {
        type: 'Column',
        width: 'auto',
        verticalContentAlignment: 'center',
        items: [{
          type: 'TextBlock',
          text: count > 0 ? `${count}표` : '  ',
          weight: 'bolder',
          color: count > 0 ? 'accent' : 'default',
          size: 'medium',
          horizontalAlignment: 'center',
        }],
      },
      // 중: 식당명 + 부가정보
      {
        type: 'Column',
        width: 'stretch',
        verticalContentAlignment: 'center',
        items: [
          {
            type: 'TextBlock',
            text: nameText,
            weight: isSelected ? 'bolder' : 'default',
            color: textColor,
            wrap: true,
          },
          ...subItems,
        ],
      },
      // 우: 투표 버튼 (ActionSet → Teams에서 실제 버튼으로 렌더링)
      {
        type: 'Column',
        width: 'auto',
        verticalContentAlignment: 'center',
        items: [{
          type: 'ActionSet',
          actions: [{
            type: 'Action.Execute',
            verb,
            title: isSelected ? '✅ 취소' : '🗳️ 투표',
            data,
          }],
        }],
      },
    ],
  };
}

// Vote card - 투표 UI 개선: 득표수 뱃지 + 명시적 버튼
export function buildVoteCard(
  restaurants: Restaurant[],
  voteResults: VoteResult[],
  soloCount: number,
  userVoteRestaurantIds?: number[],
  userIsSolo?: boolean,
  userIsAny?: boolean,
  votersByRestaurant?: Map<number, VoterEntry[]>,
  soloVoters?: VoterEntry[],
  anyVoters?: VoterEntry[],
  anyCount?: number,
  uniqueVoterCount?: number,
  deliveryMode?: boolean,
  globalBlacklistedIds?: number[]
): Attachment {
  const voteMap = new Map(voteResults.map(v => [v.restaurant_id, v.count]));
  const userVoteIds = new Set(userVoteRestaurantIds || []);
  const globalBlackSet = new Set(globalBlacklistedIds || []);

  const stats = `👥 ${uniqueVoterCount || 0}명 참여  ·  🍱 혼밥 ${soloCount}명  ·  🎲 아무거나 ${anyCount || 0}명`;

  const body: any[] = [
    buildTopMenuActionSet(),
    {
      type: 'ColumnSet',
      columns: [
        {
          type: 'Column',
          width: 'stretch',
          items: [{
            type: 'TextBlock',
            text: `🍽️ 오늘 점심 뭐먹지?${deliveryMode ? '  🛵 배달모드' : ''}`,
            weight: 'bolder',
            size: 'large',
          }],
        },
      ],
    },
    {
      type: 'TextBlock',
      text: stats,
      wrap: true,
      spacing: 'none',
      isSubtle: true,
      size: 'small',
    },
  ];

  if (deliveryMode) {
    body.push({
      type: 'TextBlock',
      text: '🛵 오늘은 배달 메뉴입니다.',
      wrap: true,
      color: 'accent',
      spacing: 'small',
    });
  }

  // 구분선
  body.push({ type: 'TextBlock', text: '─────────────────', isSubtle: true, spacing: 'small', size: 'small' });

  // 혼밥 / 아무거나 - 최상단
  const soloSubItems: any[] = soloVoters && soloVoters.length > 0
    ? [{ type: 'TextBlock', text: soloVoters.map(v => v.user_name).join(', '), size: 'small', isSubtle: true, wrap: true, spacing: 'none' }]
    : [];
  body.push(buildVoteRow('vote_solo', {}, '🍱 혼밥', soloSubItems, soloCount, !!userIsSolo, userIsSolo ? 'good' : 'default'));

  const anySubItems: any[] = anyVoters && anyVoters.length > 0
    ? [{ type: 'TextBlock', text: anyVoters.map(v => v.user_name).join(', '), size: 'small', isSubtle: true, wrap: true, spacing: 'none' }]
    : [];
  body.push(buildVoteRow('vote_any', {}, '🎲 아무거나', anySubItems, anyCount || 0, !!userIsAny, userIsAny ? 'good' : 'default'));

  // 구분선
  body.push({ type: 'TextBlock', text: '─────────────────', isSubtle: true, spacing: 'small', size: 'small' });

  // 식당 목록 - 득표수 내림차순 정렬
  const sortedRestaurants = [...restaurants].sort((a, b) => {
    const countA = voteMap.get(a.id) ?? 0;
    const countB = voteMap.get(b.id) ?? 0;
    return countB - countA;
  });

  for (const restaurant of sortedRestaurants) {
    const count = voteMap.get(restaurant.id) ?? 0;
    const isSelected = userVoteIds.has(restaurant.id);
    const isGlobalBlacklisted = globalBlackSet.has(restaurant.id);
    const voters = votersByRestaurant?.get(restaurant.id) || [];
    const voterNames = voters.map(v => v.user_name).join(', ');

    const textColor = isGlobalBlacklisted ? 'attention' : (isSelected ? 'good' : 'default');
    const nameText = `${restaurant.name}${restaurant.alias ? ` · ${restaurant.alias}` : ''}`;

    const subItems: any[] = [];
    if (isGlobalBlacklisted) {
      subItems.push({ type: 'TextBlock', text: '⚠️ 누군가의 블랙리스트', size: 'small', color: 'attention', isSubtle: true, spacing: 'none' });
    }
    if (voterNames) {
      subItems.push({ type: 'TextBlock', text: voterNames, size: 'small', isSubtle: true, wrap: true, spacing: 'none' });
    }

    body.push(buildVoteRow(
      'vote',
      { restaurantId: restaurant.id, restaurantName: restaurant.name },
      nameText, subItems, count, isSelected, textColor
    ));
  }

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}

// Recommendation card - 제목 우측 새로고침 인라인 + 투표 버튼
export function buildRecommendCard(recommendations: RecommendationResult[]): Attachment {
  const body: any[] = [
    buildTopMenuActionSet(),
    // 제목과 새로고침 버튼을 같은 줄에 배치
    {
      type: 'ColumnSet',
      columns: [
        {
          type: 'Column',
          width: 'stretch',
          verticalContentAlignment: 'center',
          items: [{ type: 'TextBlock', text: '🤖 AI 추천 메뉴', weight: 'bolder', size: 'large' }],
        },
        {
          type: 'Column',
          width: 'auto',
          verticalContentAlignment: 'center',
          items: [{
            type: 'ActionSet',
            actions: [{
              type: 'Action.Execute',
              verb: 'refresh_recommend',
              title: '🔄',
              data: {},
            }],
          }],
        },
      ],
    },
    ...recommendations.map((r, i) => ({
      type: 'ColumnSet',
      selectAction: {
        type: 'Action.Execute',
        verb: 'vote',
        data: { restaurantName: r.name },
      },
      columns: [
        {
          type: 'Column',
          width: 'stretch',
          items: [
            {
              type: 'TextBlock',
              text: `${i + 1}. **${r.name}**`,
              weight: 'bolder',
              wrap: true,
            },
            {
              type: 'TextBlock',
              text: r.reason,
              wrap: true,
              isSubtle: true,
              spacing: 'small',
              size: 'small',
            },
          ],
        },
        {
          type: 'Column',
          width: 'auto',
          items: [{
            type: 'TextBlock',
            text: '▶ 투표',
            horizontalAlignment: 'right',
            color: 'accent',
            weight: 'bolder',
          }],
        },
      ],
    })),
  ];

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}

// Review card
export function buildReviewCard(restaurantName: string): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      buildTopMenuActionSet(),
      {
        type: 'TextBlock',
        text: '⭐ 식사 리뷰',
        weight: 'bolder',
        size: 'large',
      },
      {
        type: 'TextBlock',
        text: `${restaurantName}의 평점을 매겨주세요!`,
        wrap: true,
      },
    ],
    actions: [
      { type: 'Action.Execute', verb: 'review', title: '⭐ 1점',     data: { restaurantName, rating: 1 } },
      { type: 'Action.Execute', verb: 'review', title: '⭐⭐ 2점',   data: { restaurantName, rating: 2 } },
      { type: 'Action.Execute', verb: 'review', title: '⭐⭐⭐ 3점', data: { restaurantName, rating: 3 } },
      { type: 'Action.Execute', verb: 'review', title: '⭐⭐⭐⭐ 4점',   data: { restaurantName, rating: 4 } },
      { type: 'Action.Execute', verb: 'review', title: '⭐⭐⭐⭐⭐ 5점', data: { restaurantName, rating: 5 } },
    ],
  });
}

// Response card
export function buildResponseCard(message: string, showBack?: boolean): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [{ type: 'TextBlock', text: message, wrap: true }],
    actions: showBack ? [{
      type: 'Action.Execute',
      verb: 'main_menu',
      title: '🏠 메뉴로',
      data: {},
    }] : [],
  });
}

// 식당 목록 한 행 (🚫 ✏️ 🗑️ 버튼 포함)
function buildRestaurantRow(r: Restaurant, userBlackSet: Set<number>, globalBlackSet: Set<number>): any {
  const isUserBlacklisted = userBlackSet.has(r.id);
  const isGlobalBlacklisted = globalBlackSet.has(r.id);
  const deliveryBadge = r.is_delivery ? ' 🛵' : '';
  const nameText = `${isUserBlacklisted ? '🚫 ' : ''}${r.name}${r.alias ? ` (${r.alias})` : ''}${deliveryBadge}`;
  const detailText = `${r.category} | ${r.distance}m | ₩${r.price.toLocaleString()}`;

  return {
    type: 'ColumnSet',
    columns: [
      {
        type: 'Column',
        width: 'stretch',
        items: [
          {
            type: 'TextBlock',
            text: nameText,
            weight: 'bolder',
            wrap: true,
            ...(isGlobalBlacklisted ? { color: 'attention' } : {}),
          },
          { type: 'TextBlock', text: detailText, size: 'small', isSubtle: true, spacing: 'none', wrap: true },
        ],
      },
      {
        type: 'Column',
        width: 'auto',
        items: [{ type: 'ActionSet', actions: [{ type: 'Action.Execute', verb: 'blacklist_toggle', title: isUserBlacklisted ? '🚫✓' : '🚫', data: { restaurantId: r.id, restaurantName: r.name } }] }],
      },
      {
        type: 'Column',
        width: 'auto',
        items: [{ type: 'ActionSet', actions: [{ type: 'Action.Execute', verb: 'edit_restaurant', title: '✏️', data: { restaurantId: r.id } }] }],
      },
      {
        type: 'Column',
        width: 'auto',
        items: [{ type: 'ActionSet', actions: [{ type: 'Action.Execute', verb: 'delete_restaurant', title: '🗑️', data: { restaurantId: r.id, restaurantName: r.name } }] }],
      },
    ],
  };
}

export type SortKey = { field: 'name' | 'distance' | 'price'; order: 'asc' | 'desc' };

// List card - 복수 정렬 + 카테고리 그룹핑 + 각 행 인라인 버튼
export function buildListCard(
  restaurants: Restaurant[],
  blacklistedIds: number[] = [],
  sortKeys: SortKey[] = [],
  groupByCategory: boolean = false,
  userBlacklistedIds: number[] = []
): Attachment {
  const userBlackSet = new Set(userBlacklistedIds);
  const globalBlackSet = new Set(blacklistedIds);

  // 정렬 버튼 상태 계산
  const PRIORITY_NUM = ['①', '②', '③'];
  function getSortButton(field: 'name' | 'distance' | 'price', baseLabel: string): { title: string; nextKeys: SortKey[] } {
    const idx = sortKeys.findIndex(k => k.field === field);
    if (idx === -1) {
      // 비활성 → 클릭 시 마지막에 asc 추가
      return { title: baseLabel, nextKeys: [...sortKeys, { field, order: 'asc' }] };
    }
    const priority = PRIORITY_NUM[idx] ?? `${idx + 1}`;
    if (sortKeys[idx].order === 'asc') {
      // 오름차순 활성 → 클릭 시 내림차순
      const next = sortKeys.map((k, i) => i === idx ? { ...k, order: 'desc' as const } : k);
      return { title: `${baseLabel}${priority}▲`, nextKeys: next };
    } else {
      // 내림차순 활성 → 클릭 시 제거 (뒤 항목 우선순위 당김)
      return { title: `${baseLabel}${priority}▼`, nextKeys: sortKeys.filter((_, i) => i !== idx) };
    }
  }

  const nameSortBtn    = getSortButton('name',     '가나다');
  const distSortBtn    = getSortButton('distance', '거리');
  const priceSortBtn   = getSortButton('price',    '가격');

  const body: any[] = [
    buildTopMenuActionSet(),
    {
      type: 'TextBlock',
      text: `🍽️ 식당 목록 (총 ${restaurants.length}개)`,
      weight: 'bolder',
      size: 'large',
    },
    {
      type: 'ActionSet',
      actions: [
        { type: 'Action.Execute', verb: 'sort_list', title: nameSortBtn.title,  data: { sortKeys: nameSortBtn.nextKeys,  groupByCategory } },
        { type: 'Action.Execute', verb: 'sort_list', title: distSortBtn.title,  data: { sortKeys: distSortBtn.nextKeys,  groupByCategory } },
        { type: 'Action.Execute', verb: 'sort_list', title: priceSortBtn.title, data: { sortKeys: priceSortBtn.nextKeys, groupByCategory } },
        {
          type: 'Action.Execute', verb: 'sort_list',
          title: groupByCategory ? '종류 ✓' : '종류',
          data: { sortKeys, groupByCategory: !groupByCategory },
        },
        { type: 'Action.Execute', verb: 'add_restaurant_form', title: '➕ 식당추가', data: {} },
      ],
    },
  ];

  // 정렬 적용
  let sorted = [...restaurants];
  if (sortKeys.length > 0) {
    sorted.sort((a, b) => {
      for (const key of sortKeys) {
        let cmp = 0;
        if (key.field === 'name')     cmp = a.name.localeCompare(b.name, 'ko');
        else if (key.field === 'distance') cmp = a.distance - b.distance;
        else if (key.field === 'price')    cmp = a.price - b.price;
        if (cmp !== 0) return key.order === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  // 카테고리 그룹핑 뷰
  if (groupByCategory) {
    const grouped = sorted.reduce((acc, r) => {
      if (!acc[r.category]) acc[r.category] = [];
      acc[r.category].push(r);
      return acc;
    }, {} as Record<string, Restaurant[]>);

    const ORDER = ['한식', '중식', '일식', '양식', '분식', '기타'];
    const cats = ORDER.filter(c => grouped[c]);
    Object.keys(grouped).forEach(c => { if (!cats.includes(c)) cats.push(c); });

    for (const cat of cats) {
      body.push({
        type: 'TextBlock',
        text: `**${cat}** (${grouped[cat].length}개)`,
        weight: 'bolder',
        spacing: 'medium',
        color: 'accent',
      });
      for (const r of grouped[cat]) {
        body.push(buildRestaurantRow(r, userBlackSet, globalBlackSet));
      }
    }
  } else {
    for (const r of sorted) {
      body.push(buildRestaurantRow(r, userBlackSet, globalBlackSet));
    }
  }

  if (restaurants.length === 0) {
    body.push({ type: 'TextBlock', text: '등록된 식당이 없습니다.', isSubtle: true, wrap: true });
  }

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}

// Edit restaurant card - 별명 필드 포함
export function buildEditRestaurantCard(restaurant: Restaurant): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      buildTopMenuActionSet(),
      { type: 'TextBlock', text: `✏️ 식당 수정: ${restaurant.name}`, weight: 'bolder', size: 'large' },
      { type: 'TextBlock', text: '식당명', weight: 'bolder', spacing: 'medium' },
      { type: 'Input.Text', id: 'name', value: restaurant.name, placeholder: '식당 이름' },
      { type: 'TextBlock', text: '별명 (선택사항)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'alias', value: restaurant.alias ?? '', placeholder: '예: 2층식당, 된장찌개집' },
      { type: 'TextBlock', text: '카테고리', weight: 'bolder', spacing: 'small' },
      {
        type: 'Input.ChoiceSet',
        id: 'category',
        value: restaurant.category,
        choices: [
          { title: '한식', value: '한식' }, { title: '중식', value: '중식' },
          { title: '일식', value: '일식' }, { title: '양식', value: '양식' },
          { title: '분식', value: '분식' }, { title: '기타', value: '기타' },
        ],
      },
      { type: 'TextBlock', text: '거리 (m)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'distance', value: String(restaurant.distance), placeholder: '거리 (미터)' },
      { type: 'TextBlock', text: '가격 (₩)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'price', value: String(restaurant.price), placeholder: '가격' },
      {
        type: 'Input.Toggle',
        id: 'is_delivery',
        title: '🛵 배달 가능',
        value: restaurant.is_delivery ? 'true' : 'false',
        valueOn: 'true',
        valueOff: 'false',
        spacing: 'small',
      },
    ],
    actions: [
      { type: 'Action.Execute', verb: 'save_restaurant',  title: '✅ 저장', associatedInputs: 'auto', data: { restaurantId: restaurant.id } },
      { type: 'Action.Execute', verb: 'cancel_edit',      title: '❌ 취소', data: {} },
    ],
  });
}

// Add restaurant card - 별명 필드 포함
export function buildAddRestaurantCard(): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      buildTopMenuActionSet(),
      { type: 'TextBlock', text: '➕ 식당 추가', weight: 'bolder', size: 'large' },
      { type: 'TextBlock', text: '식당명', weight: 'bolder', spacing: 'medium' },
      { type: 'Input.Text', id: 'name', placeholder: '식당 이름' },
      { type: 'TextBlock', text: '별명 (선택사항)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'alias', placeholder: '예: 2층식당, 된장찌개집' },
      { type: 'TextBlock', text: '카테고리', weight: 'bolder', spacing: 'small' },
      {
        type: 'Input.ChoiceSet',
        id: 'category',
        value: '한식',
        choices: [
          { title: '한식', value: '한식' }, { title: '중식', value: '중식' },
          { title: '일식', value: '일식' }, { title: '양식', value: '양식' },
          { title: '분식', value: '분식' }, { title: '기타', value: '기타' },
        ],
      },
      { type: 'TextBlock', text: '거리 (m)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'distance', placeholder: '거리 (미터)' },
      { type: 'TextBlock', text: '가격 (₩)', weight: 'bolder', spacing: 'small' },
      { type: 'Input.Text', id: 'price', placeholder: '가격' },
      {
        type: 'Input.Toggle',
        id: 'is_delivery',
        title: '🛵 배달 가능',
        value: 'false',
        valueOn: 'true',
        valueOff: 'false',
        spacing: 'small',
      },
    ],
    actions: [
      { type: 'Action.Execute', verb: 'create_restaurant', title: '➕ 추가',   associatedInputs: 'auto', data: {} },
      { type: 'Action.Execute', verb: 'show_list',         title: '❌ 취소',   data: {} },
    ],
  });
}

// Blacklist card
export function buildBlacklistCard(restaurants: Restaurant[]): Attachment {
  if (restaurants.length === 0) {
    return buildResponseCard('블랙리스트가 비어있습니다.', true);
  }

  const body: any[] = [
    buildTopMenuActionSet(),
    { type: 'TextBlock', text: '🚫 내 블랙리스트', weight: 'bolder', size: 'large' },
  ];

  for (const r of restaurants) {
    body.push({
      type: 'ColumnSet',
      selectAction: {
        type: 'Action.Execute',
        verb: 'blacklist_remove',
        data: { restaurantId: r.id, restaurantName: r.name },
      },
      columns: [
        {
          type: 'Column',
          width: 'stretch',
          items: [{
            type: 'TextBlock',
            text: `${r.name}${r.alias ? ` (${r.alias})` : ''} | ${r.category} | ${r.distance}m`,
            wrap: true,
          }],
        },
        {
          type: 'Column',
          width: 'auto',
          items: [{ type: 'TextBlock', text: '🗑️', horizontalAlignment: 'right' }],
        },
      ],
    });
  }

  body.push({
    type: 'TextBlock',
    text: '(항목을 클릭하면 블랙리스트에서 제거됩니다)',
    wrap: true,
    isSubtle: true,
    spacing: 'medium',
  });

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}

// Settings card - 식대 수정 + 강제결정/배달 단일 토글 버튼 + 하단 메뉴버튼 제거
export function buildSettingsCard(budget: number, forceEnabled: boolean, deliveryModeActive: boolean = false): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      buildTopMenuActionSet(),
      { type: 'TextBlock', text: '⚙️ 설정', weight: 'bolder', size: 'large' },
      {
        type: 'TextBlock',
        text: `📊 1인 식대: ₩${budget.toLocaleString()}`,
        wrap: true,
        spacing: 'medium',
        weight: 'bolder',
      },
      {
        type: 'Input.Text',
        id: 'budget',
        value: String(budget),
        placeholder: '식대 금액 입력',
        spacing: 'small',
      },
      {
        type: 'TextBlock',
        text: `🔔 강제결정: ${forceEnabled ? 'ON ✅' : 'OFF'}`,
        wrap: true,
        spacing: 'medium',
        ...(forceEnabled ? { color: 'good' } : { isSubtle: true }),
      },
      {
        type: 'TextBlock',
        text: `🛵 배달 모드: ${deliveryModeActive ? 'ON ✅' : 'OFF'}`,
        wrap: true,
        spacing: 'small',
        ...(deliveryModeActive ? { color: 'accent' } : { isSubtle: true }),
      },
    ],
    actions: [
      {
        type: 'Action.Execute',
        verb: 'set_budget',
        title: '💰 식대 저장',
        associatedInputs: 'auto',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'toggle_force_decision',
        title: forceEnabled ? '🔕 강제결정 끄기' : '🔔 강제결정 켜기',
        associatedInputs: 'none',
        data: {},
      },
      {
        type: 'Action.Execute',
        verb: 'toggle_delivery_setting',
        title: deliveryModeActive ? '🛵 배달 모드 끄기' : '🛵 배달 모드 켜기',
        associatedInputs: 'none',
        data: {},
      },
    ],
  });
}

function buildWeatherLabel(temp?: number | null, condition?: string | null): string {
  if (temp == null && !condition) return '';
  const emoji =
    condition === 'rain'   ? '🌧️' :
    condition === 'snow'   ? '❄️' :
    condition === 'clouds' ? '☁️' : '☀️';
  const parts: string[] = [];
  if (temp != null) parts.push(`${temp}°C`);
  if (condition)    parts.push(condition === 'rain' ? '비' : condition === 'snow' ? '눈' : condition === 'clouds' ? '흐림' : '맑음');
  return `${emoji} ${parts.join(', ')}`;
}

// Dashboard/History card
function getWeekOfMonth(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  return Math.ceil((date.getDate() + firstDay.getDay()) / 7);
}

export function buildDashboardCard(
  history: SelectedHistory[],
  restaurantRepo: RestaurantRepository,
  view: 'week' | 'month' = 'week'
): Attachment {
  const today = new Date();
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  // 뷰에 따라 필터
  let filtered: SelectedHistory[];
  let title: string;

  if (view === 'week') {
    const dow = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    const mondayStr = monday.toISOString().split('T')[0];
    filtered = history.filter(h => h.selected_date >= mondayStr);
    title = '📊 이번 주 점심';
  } else {
    const monthPrefix = today.toISOString().slice(0, 7); // YYYY-MM
    filtered = history.filter(h => h.selected_date.startsWith(monthPrefix));
    title = `📊 ${today.getMonth() + 1}월 점심`;
  }

  const body: any[] = [
    buildTopMenuActionSet(),
    {
      type: 'ActionSet',
      actions: [
        { type: 'Action.Execute', verb: 'dashboard_view', title: view === 'week' ? '주간 ✓' : '주간', data: { view: 'week' } },
        { type: 'Action.Execute', verb: 'dashboard_view', title: view === 'month' ? '월간 ✓' : '월간', data: { view: 'month' } },
      ],
    },
    { type: 'TextBlock', text: title, weight: 'bolder', size: 'large', spacing: 'small' },
  ];

  if (filtered.length === 0) {
    body.push({ type: 'TextBlock', text: '아직 기록이 없습니다.', isSubtle: true, spacing: 'medium' });
  } else if (view === 'week') {
    // 주간: 날짜별 목록
    const sorted = [...filtered].sort((a, b) => a.selected_date.localeCompare(b.selected_date));
    for (const h of sorted) {
      const restaurant = restaurantRepo.findById(h.restaurant_id);
      const d = new Date(h.selected_date + 'T00:00:00');
      const dayLabel = `${h.selected_date.slice(5)} (${DAY_NAMES[d.getDay()]})`;
      const weatherLabel = buildWeatherLabel(h.weather_temp, h.weather_condition);
      body.push({
        type: 'ColumnSet',
        spacing: 'small',
        columns: [
          { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: dayLabel, isSubtle: true, size: 'small' }] },
          { type: 'Column', width: 'stretch', items: [
            { type: 'TextBlock', text: restaurant?.name ?? '알 수 없음', weight: 'bolder' },
            ...(weatherLabel ? [{ type: 'TextBlock', text: weatherLabel, isSubtle: true, size: 'small', spacing: 'none' }] : []),
          ]},
          { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: `${h.vote_count}표`, color: 'accent', isSubtle: true }] },
        ],
      });
    }
  } else {
    // 월간: 단골 TOP3 + 주차별 상세
    const counts = new Map<number, { name: string; count: number }>();
    for (const h of filtered) {
      const r = restaurantRepo.findById(h.restaurant_id);
      if (r) {
        const ex = counts.get(h.restaurant_id);
        if (ex) ex.count++;
        else counts.set(h.restaurant_id, { name: r.name, count: 1 });
      }
    }
    const topPicks = Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 3);

    body.push({ type: 'TextBlock', text: `총 ${filtered.length}일 기록`, isSubtle: true, spacing: 'small', size: 'small' });

    if (topPicks.length > 0) {
      body.push({ type: 'TextBlock', text: '🏆 이달의 단골', weight: 'bolder', spacing: 'medium' });
      ['🥇', '🥈', '🥉'].slice(0, topPicks.length).forEach((medal, i) => {
        body.push({
          type: 'ColumnSet',
          spacing: 'small',
          columns: [
            { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: medal }] },
            { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: topPicks[i].name, weight: 'bolder' }] },
            { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: `${topPicks[i].count}회`, color: 'accent', weight: 'bolder' }] },
          ],
        });
      });
    }

    // 주차별 상세
    body.push({ type: 'TextBlock', text: '📋 상세 기록', weight: 'bolder', spacing: 'medium' });
    const sorted = [...filtered].sort((a, b) => a.selected_date.localeCompare(b.selected_date));
    let currentWeek = -1;
    for (const h of sorted) {
      const d = new Date(h.selected_date + 'T00:00:00');
      const week = getWeekOfMonth(d);
      if (week !== currentWeek) {
        body.push({ type: 'TextBlock', text: `${week}주차`, weight: 'bolder', color: 'accent', spacing: 'small', size: 'small' });
        currentWeek = week;
      }
      const restaurant = restaurantRepo.findById(h.restaurant_id);
      const dayLabel = `${h.selected_date.slice(5)} (${DAY_NAMES[d.getDay()]})`;
      const weatherLabel = buildWeatherLabel(h.weather_temp, h.weather_condition);
      body.push({
        type: 'ColumnSet',
        spacing: 'small',
        columns: [
          { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: dayLabel, isSubtle: true, size: 'small' }] },
          { type: 'Column', width: 'stretch', items: [
            { type: 'TextBlock', text: restaurant?.name ?? '알 수 없음' },
            ...(weatherLabel ? [{ type: 'TextBlock', text: weatherLabel, isSubtle: true, size: 'small', spacing: 'none' }] : []),
          ]},
          { type: 'Column', width: 'auto',    items: [{ type: 'TextBlock', text: `${h.vote_count}표`, isSubtle: true, color: 'accent', size: 'small' }] },
        ],
      });
    }
  }

  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
  });
}
