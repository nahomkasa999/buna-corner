export type Category = "Coffee" | "Tea" | "Food" | "Beans";

export interface MenuOptionGroup {
  name: string;
  choices: { label: string; priceDelta: number }[];
}

export interface MenuItem {
  id: string;
  slug: string;
  name: string;
  amharicName: string;
  description: string;
  price: number; // ETB, base (small / default)
  category: Category;
  image: string;
  popular?: boolean;
  soldOut?: boolean;
  hidden?: boolean;
  options?: MenuOptionGroup[];
}

const img = (id: string) =>
  `https://images.unsplash.com/${id}?q=80&w=800&auto=format&fit=crop`;

export const CATEGORIES: Category[] = ["Coffee", "Tea", "Food", "Beans"];

export const SIZE_OPTIONS: MenuOptionGroup = {
  name: "Size",
  choices: [
    { label: "Small", priceDelta: 0 },
    { label: "Medium", priceDelta: 30 },
    { label: "Large", priceDelta: 60 },
  ],
};

export const MILK_OPTIONS: MenuOptionGroup = {
  name: "Milk",
  choices: [
    { label: "Whole", priceDelta: 0 },
    { label: "Oat", priceDelta: 20 },
    { label: "Almond", priceDelta: 20 },
    { label: "No milk", priceDelta: 0 },
  ],
};

export const SUGAR_OPTIONS: MenuOptionGroup = {
  name: "Sugar",
  choices: [
    { label: "Normal", priceDelta: 0 },
    { label: "Less", priceDelta: 0 },
    { label: "No sugar", priceDelta: 0 },
  ],
};

const drinkOptions = [SIZE_OPTIONS, MILK_OPTIONS, SUGAR_OPTIONS];

export const MENU_ITEMS: MenuItem[] = [
  {
    id: "macchiato", slug: "ethiopian-macchiato", name: "Ethiopian Macchiato",
    amharicName: "ማኪያቶ", description: "Addis Ababa's beloved macchiato — rich espresso marked with a cloud of steamed milk. Smooth, strong, unmistakably Ethiopian.",
    price: 80, category: "Coffee", image: img("photo-1572442388796-11668a67e53d"), popular: true, options: drinkOptions,
  },
  {
    id: "jebena-buna", slug: "jebena-buna", name: "Buna (Traditional Jebena Coffee)",
    amharicName: "ቡና", description: "Slow-brewed in a clay jebena over charcoal, served the traditional way with popcorn and incense. The full ceremony in a cup.",
    price: 60, category: "Coffee", image: img("photo-1447933601403-0c6688de566e"), popular: true, options: [SUGAR_OPTIONS],
  },
  {
    id: "espresso", slug: "espresso", name: "Espresso",
    amharicName: "ኤስፕሬሶ", description: "Double shot of single-origin Yirgacheffe — bright, floral, with a honeyed finish.",
    price: 70, category: "Coffee", image: img("photo-1510591509098-f4fdc6d0ff04"), options: drinkOptions,
  },
  {
    id: "cappuccino", slug: "cappuccino", name: "Cappuccino",
    amharicName: "ካፑቺኖ", description: "Velvety steamed milk over a double shot, dusted with cocoa. A slow-morning classic.",
    price: 120, category: "Coffee", image: img("photo-1572442388796-11668a67e53d"), popular: true, options: drinkOptions,
  },
  {
    id: "cafe-latte", slug: "cafe-latte", name: "Café Latte",
    amharicName: "ላቴ", description: "Silky milk, gentle espresso, latte art on top. Our most-loved milky coffee.",
    price: 130, category: "Coffee", image: img("photo-1541167760496-1628856ab772"), options: drinkOptions,
  },
  {
    id: "cold-brew", slug: "cold-brew", name: "Cold Brew",
    amharicName: "ኮልድ ብሩ", description: "18-hour slow-steeped Yirgacheffe, served over ice. Chocolatey, low-acid, dangerously smooth.",
    price: 150, category: "Coffee", image: img("photo-1517701604599-bb29b565090c"), popular: true, options: [SIZE_OPTIONS],
  },
  {
    id: "hot-chocolate", slug: "hot-chocolate", name: "Hot Chocolate",
    amharicName: "ትኩስ ቸኮሌት", description: "Thick, dark Ethiopian chocolate melted into steamed milk, topped with cream.",
    price: 120, category: "Coffee", image: img("photo-1542990253-a781e04c0082"), options: drinkOptions,
  },
  {
    id: "shai", slug: "shai", name: "Shai (Spiced Tea)",
    amharicName: "ሻይ", description: "Black tea simmered with cardamom, cinnamon and cloves — the tea every Addis household runs on.",
    price: 50, category: "Tea", image: img("photo-1594631252845-29fc4cc8cde9"), popular: true, options: [SIZE_OPTIONS, SUGAR_OPTIONS],
  },
  {
    id: "green-tea", slug: "green-tea", name: "Green Tea",
    amharicName: "አረንጓዴ ሻይ", description: "Light, grassy green tea with a hint of mint. A calm reset between meetings.",
    price: 60, category: "Tea", image: img("photo-1564890369478-c89ca6d9cde9"), options: [SIZE_OPTIONS, SUGAR_OPTIONS],
  },
  {
    id: "avocado-smoothie", slug: "avocado-smoothie", name: "Avocado Smoothie",
    amharicName: "አቮካዶ ጁስ", description: "Ripe Hass avocado blended with milk and honey — thick, creamy, a meal in a glass.",
    price: 140, category: "Food", image: img("photo-1623065422902-30a2d299bbe4"), popular: true, options: [SIZE_OPTIONS],
  },
  {
    id: "sambusa", slug: "sambusa", name: "Sambusa (2 pc)",
    amharicName: "ሳምቡሳ", description: "Crisp pastry filled with spiced lentils, served hot with awaze dip.",
    price: 60, category: "Food", image: img("photo-1601050690597-df0568f70950"),
  },
  {
    id: "ful", slug: "breakfast-ful", name: "Breakfast Ful",
    amharicName: "ፉል", description: "Slow-cooked fava beans with tomato, onion and berbere, warm bread on the side. The Addis breakfast.",
    price: 120, category: "Food", image: img("photo-1547592180-85f173990554"),
  },
  {
    id: "croissant", slug: "croissant", name: "Croissant",
    amharicName: "ክሩዋሳን", description: "Buttery, flaky, baked fresh every morning. Perfect with a macchiato.",
    price: 90, category: "Food", image: img("photo-1555507036-ab1f4038808a"),
  },
  {
    id: "yirgacheffe-beans", slug: "yirgacheffe-beans-250g", name: "Yirgacheffe Beans — 250 g",
    amharicName: "ይርጋጨፌ ቡና", description: "Washed Yirgacheffe, floral and citrusy. Whole bean, roasted in-house this week. Take the café home.",
    price: 850, category: "Beans", image: img("photo-1442512595331-e89e73853f31"), popular: true,
  },
  {
    id: "sidamo-beans", slug: "sidamo-beans-250g", name: "Sidamo Beans — 250 g",
    amharicName: "ሲዳሞ ቡና", description: "Natural Sidamo, berry-sweet and full-bodied. Whole bean, roasted in-house this week.",
    price: 800, category: "Beans", image: img("photo-1611854779393-1b2da9d400fe"),
  },
];

export const SUBSCRIPTION_PLAN = {
  id: "beans-monthly",
  name: "Beans of the Month",
  price: 900,
  description: "250 g of our freshest single-origin, delivered or ready for pickup every month. First month includes a free macchiato.",
  perks: ["250 g fresh-roasted beans monthly", "Free macchiato on pickup day", "Members-only tastings", "Pause or cancel anytime"],
};
