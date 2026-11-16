import type { WorkoutKind } from "../core/types";

export interface Plan {
  id: string;
  name: string;
  price: number;
  period: string;
  tagline: string;
  features: string[];
  popular?: boolean;
  badge?: string;
}

export const PLANS: Plan[] = [
  {
    id: "single",
    name: "Разовая",
    price: 2500,
    period: "за тренировку",
    tagline: "Попробовать без обязательств",
    features: [
      "Любая тренировка из расписания",
      "Отмена без штрафа за 2 часа",
      "Полотенце и вода включены",
    ],
  },
  {
    id: "month",
    name: "Безлимит",
    price: 19900,
    period: "в месяц",
    tagline: "Тренируйся сколько хочешь",
    popular: true,
    badge: "Выбор клиентов",
    features: [
      "Все направления без ограничений",
      "Заморозка до 7 дней",
      "Приоритетная запись на вечер",
      "Гостевой визит для друга",
    ],
  },
  {
    id: "year",
    name: "Год",
    price: 149900,
    period: "в год",
    tagline: "Максимальная выгода",
    badge: "Выгода 37%",
    features: [
      "Всё из «Безлимита»",
      "2 персональные тренировки",
      "Заморозка до 30 дней",
      "Цена зафиксирована на год",
    ],
  },
];

export const formatPrice = (value: number): string =>
  `${value.toLocaleString("ru-RU")} ₸`;

const portrait = (id: string): string =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=400&q=70`;

export interface Trainer {
  name: string;
  kind: WorkoutKind;
  role: string;
  experience: string;
  quote: string;
  photo: string;
}
export const TRAINERS: Trainer[] = [
  {
    name: "Дмитрий Ким",
    kind: "strength",
    role: "Силовой тренинг",
    experience: "8 лет опыта",
    quote: "Техника прежде всего. Сила приходит следом.",
    photo: portrait("photo-1507003211169-0a1dd7228f2d"),
  },
  {
    name: "Марат Абдрахманов",
    kind: "cardio",
    role: "Кардио и выносливость",
    experience: "6 лет опыта",
    quote: "Пульс — твой честный тренер. Слушай его.",
    photo: portrait("photo-1500648767791-00dcc994a43e"),
  },
  {
    name: "Айгерим Сапарова",
    kind: "yoga",
    role: "Йога и осанка",
    experience: "7 лет опыта",
    quote: "Гибкость — это свобода движения в любом возрасте.",
    photo: portrait("photo-1544005313-94ddf0286df2"),
  },
  {
    name: "Сергей Ли",
    kind: "crossfit",
    role: "Кроссфит и функционалка",
    experience: "5 лет опыта",
    quote: "Каждый раунд — маленькая победа над собой.",
    photo: portrait("photo-1506794778202-cad84cf45f1d"),
  },
  {
    name: "Алина Ким",
    kind: "stretch",
    role: "Стретчинг и мобильность",
    experience: "4 года опыта",
    quote: "Тело скажет спасибо уже после первого занятия.",
    photo: portrait("photo-1573496359142-b8d87734a5a2"),
  },
];

export interface Direction {
  kind: WorkoutKind;
  title: string;
  description: string;
  duration: string;
}
export const DIRECTIONS: Direction[] = [
  {
    kind: "strength",
    title: "Силовая",
    description:
      "Свободные веса и тренажёры. Мышцы, сила и уверенная техника под контролем тренера.",
    duration: "60 мин",
  },
  {
    kind: "cardio",
    title: "Кардио",
    description:
      "Интервалы, которые разгоняют пульс и сжигают калории. Быстро, весело, эффективно.",
    duration: "45 мин",
  },
  {
    kind: "yoga",
    title: "Йога",
    description:
      "Дыхание, баланс и спокойная сила. Подходит новичкам и тем, кому за 60.",
    duration: "75 мин",
  },
  {
    kind: "crossfit",
    title: "Кроссфит",
    description:
      "Функциональные комплексы в команде. Характер закаляется здесь.",
    duration: "50 мин",
  },
  {
    kind: "stretch",
    title: "Стретчинг",
    description:
      "Растяжка и мобильность суставов. Лёгкость в теле без ударных нагрузок.",
    duration: "60 мин",
  },
];

export interface Review {
  name: string;
  text: string;
  stars: number;
}
export const REVIEWS: Review[] = [
  {
    name: "Аружан Бекова",
    stars: 5,
    text: "Записалась на йогу через телефон за минуту. Через месяц спина перестала болеть — теперь хожу три раза в неделю.",
  },
  {
    name: "Никита Волков",
    stars: 5,
    text: "Кроссфит у Сергея — лучшее, что случалось с моей формой. Минус 8 кг за три месяца, и это без диет.",
  },
  {
    name: "Елена Цой",
    stars: 5,
    text: "Мне 58, боялась, что будет поздно. Стретчинг с Алиной — бережно и внимательно. Чувствую себя на 20 лет моложе.",
  },
];

export interface FaqItem {
  q: string;
  a: string;
}
export const FAQ: FaqItem[] = [
  {
    q: "Нужна ли подготовка для первого занятия?",
    a: "Нет. Тренер подберёт нагрузку под твой уровень. Йога и стретчинг подходят даже без опыта.",
  },
  {
    q: "Что взять с собой?",
    a: "Спортивную форму, сменную обувь и бутылку воды. Полотенце, коврики и инвентарь — наши.",
  },
  {
    q: "Можно ли отменить запись?",
    a: "Да, в один клик в разделе «Мои записи». Без штрафов и звонков — место сразу освобождается.",
  },
  {
    q: "С какого возраста можно тренироваться?",
    a: "С 16 лет на все направления. Верхней границы нет: у нас занимаются и в 60+, тренер адаптирует программу.",
  },
];

export const CLUB_INFO = {
  city: "Караганда",
  address: "ул. Спортивная, 12",
  phone: "+7 (7212) 55-01-02",
  hours: "Ежедневно 07:00–23:00",
};
