import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { ControlButton } from "./ControlButton";

type Props = {
  open: boolean;
  onToggle: () => void;
};

export const RailToggleButton = ({ open, onToggle }: Props) => (
  <ControlButton
    icon={
      open ? (
        <PanelRightClose className="h-4 w-4" />
      ) : (
        <PanelRightOpen className="h-4 w-4" />
      )
    }
    label="Chapters"
    ariaLabel={open ? "Close chapters panel" : "Open chapters panel"}
    active={open}
    onClick={onToggle}
  />
);
