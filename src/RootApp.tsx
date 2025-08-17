import { BrowserRouter, Routes, Route } from "react-router-dom";
import Shows from "./pages/Shows";
import Review from "./pages/Review";

export default function RootApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Shows />} />
        <Route path="/show/:showId" element={<Review />} />
      </Routes>
    </BrowserRouter>
  );
}