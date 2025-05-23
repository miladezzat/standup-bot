import express, { Express } from 'express';

let instance: Express | null = null;

export const getExpressApp = (): Express => {
  if (!instance) {
    instance = express();
  }
  return instance;
};
