package domain

import "fmt"

func ValidateVLAN(vid int) error {
	if vid < 1 || vid > 4094 {
		return fmt.Errorf("VLAN ID must be between 1 and 4094")
	}
	return nil
}

func ValidateRackPlacement(position, height, rackUnits int, occupied [][2]int) error {
	if position < 1 || height < 1 || position+height-1 > rackUnits {
		return fmt.Errorf("device exceeds rack bounds")
	}
	start, end := position, position+height-1
	for _, span := range occupied {
		if start <= span[1] && end >= span[0] {
			return fmt.Errorf("rack position overlaps another device")
		}
	}
	return nil
}

func ValidateCable(a, b string, occupied map[string]bool) error {
	if a == b {
		return fmt.Errorf("cable endpoints must be different")
	}
	if occupied[a] || occupied[b] {
		return fmt.Errorf("port already has an active connection")
	}
	return nil
}

func CanWrite(role string) bool       { return role == "superadmin" || role == "admin" }
func CanManageUsers(role string) bool { return role == "superadmin" }
