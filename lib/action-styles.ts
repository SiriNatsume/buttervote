// Shared appearance only: callers keep their own sizing, spacing and behavior.
const actionShape = "rounded-md border-2 shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
const animatedAction = `${actionShape} match-in-progress-breathe border-transparent bg-transparent transition-colors disabled:animate-none`;

export const actionStyles = {
  participation: `${animatedAction} text-[#3F7A48] hover:text-[#2F693A] focus-visible:ring-[#75A97D]`,
  nomination: `${animatedAction} nomination-entry text-[#3F6B94] hover:text-[#315575] focus-visible:ring-[#719AC2]`,
  loveParticipation: `${animatedAction} love-vote-entry text-[#C73555] hover:text-[#A92A46] focus-visible:ring-[#FF8EA3]`,
  view: `${actionShape} animate-none border-[#D8BF87] bg-[#F3E4BD] text-[#76552D] transition-none hover:bg-[#EBD7A8] hover:text-[#65431E] focus-visible:ring-[#B99450]`,
} as const;
