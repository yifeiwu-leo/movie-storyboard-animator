export type StoryFormat = {
  aspectRatio: string;
  width: number;
  height: number;
  clipDurationSeconds: number;
  style: string;
};

export type CharacterProfile = {
  name: string;
  identity: string;
  consistency: string;
  avoid: string;
};

export type StoryScene = {
  id: string;
  chapter?: string;
  age?: string | number;
  location: string;
  caption: string;
  narration: string;
  visual: string;
  motion: string;
};

export type StoryboardStory = {
  title: string;
  format: StoryFormat;
  character: CharacterProfile;
  scenes: StoryScene[];
};
