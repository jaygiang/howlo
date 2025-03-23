// Define a fixed bingo card layout (25 items, center is "FREE")
export const bingoCard = [
  "<strong>Find someone who's new to San Diego</strong> (Ask what brought them here!)",
  "<strong>Introduce yourself to someone outside your industry</strong>",
  "<strong>Meet someone who works remotely</strong> (Ask about their favorite workspace!)",
  "<strong>Find someone looking for a co-founder or collaborator</strong> (Ask about their dream project!)",
  "<strong>Meet someone who's attended 3+ networking events this month</strong> (They're a super-connector!)",
  "<strong>Find someone who moved here for a job or startup</strong> (What's their story?)",
  "<strong>Thank the event organizer</strong> (Do it in person or via social media)",
  "<strong>Post a photo with the event organizer thanking them</strong> (Tag them and The Social Coyote!)",
  "<strong>Make 2 intros between people who haven't met before</strong> (Be the connection hero!)",
  "<strong>Snap a photo with someone you just met</strong> (Post it on LinkedIn or Slack)",
  "<strong>Ask someone what their biggest 2025 goal is</strong> (Listen, then offer support!)",
  "<strong>Share a favorite local coffee shop or co-working spot with someone</strong>",
  "FREE", // Center spot is always marked as done
  "<strong>Ask someone about the best event they've attended this year</strong> (Why was it great?)",
  "<strong>Go to an event you haven't been to before and meet someone new</strong>",
  "<strong>Go to an event in a new part of town you haven't explored and meet someone new</strong>",
  "<strong>Ask someone for their best networking tip</strong> (Write it down and share later!)",
  "<strong>Find someone who has launched a startup</strong> (Ask what stage they're at)",
  "<strong>Find someone who has raised funding for their business</strong> (Ask about their biggest lesson)",
  "<strong>Find someone who bootstrapped their business</strong> (Ask about a key challenge they overcame)",
  "<strong>Schedule a follow-up meeting with someone you met</strong> (Coffee, Zoom, or a walk!)",
  "<strong>Find another Social Coyote in the wild</strong> (Meet another event regular!)",
  "<strong>Howl or say \"Ahwoo!\" at another Social Coyote</strong> (Get them to howl back!)",
  "<strong>Come up with your own networking challenge and tag someone you completed it with! (Explain it in the comments)</strong>",
  "<strong>Find someone who's been to 3+ San Diego tech events this month</strong> (Ask which was their favorite and why!)"
];

// Check for bingo in a grid
export function checkForBingo(grid) {
  const bingoLines = [];
  
  // Check rows
  for (let row = 0; row < 5; row++) {
    if (grid[row].every(cell => cell)) {
      bingoLines.push({ type: 'row', index: row });
    }
  }
  
  // Check columns
  for (let col = 0; col < 5; col++) {
    if (grid.every(row => row[col])) {
      bingoLines.push({ type: 'column', index: col });
    }
  }
  
  // Check diagonals
  // Top-left to bottom-right
  if ([0,1,2,3,4].every(i => grid[i][i])) {
    bingoLines.push({ type: 'diagonal', index: 0 });
  }
  
  // Top-right to bottom-left
  if ([0,1,2,3,4].every(i => grid[i][4-i])) {
    bingoLines.push({ type: 'diagonal', index: 1 });
  }
  
  return {
    bingo: bingoLines.length > 0,
    bingoLines: bingoLines.length > 0 ? bingoLines : null,
    alreadyAchieved: false // Will be updated by the caller based on database check
  };
}

// Check for blackout (all cells filled)
export function checkForBlackout(grid) {
  // Checks if every cell in every row is true (excluding any empty rows)
  return grid.every(row => row.every(cell => cell));
}

// Create grid from accomplishments
export function createGridFromAccomplishments(accomplishments) {
  const grid = Array(5).fill().map(() => Array(5).fill(false));
  
  accomplishments.forEach(acc => {
    const index = bingoCard.indexOf(acc.challenge.trim());
    if (index !== -1) {
      const row = Math.floor(index / 5);
      const col = index % 5;
      grid[row][col] = true;
    }
  });
  
  // Mark FREE space as completed
  const freeIndex = bingoCard.indexOf("FREE");
  if (freeIndex !== -1) {
    grid[Math.floor(freeIndex / 5)][freeIndex % 5] = true;
  }
  
  return grid;
}

// Get all challenges (used for detecting blackout)
export function getAllChallenges() {
  // Return all challenges except the FREE space
  return bingoCard.filter(challenge => challenge !== "FREE");
}
