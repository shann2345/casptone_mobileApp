import React, { createContext, ReactNode, useContext, useState } from 'react';

interface AppContextType {
  restartApp: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [key, setKey] = useState(0);

  const restartApp = () => {
    setKey(prevKey => prevKey + 1);
  };

  return (
    <AppContext.Provider value={{ restartApp }}>
      <React.Fragment key={key}>
        {children}
      </React.Fragment>
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
